import type { AppRole, AuthSession, AuthUser } from '../domain/auth.js';
import { AuthRepository } from '../repositories/auth-repository.js';
import { hashIp, randomOpaqueToken, safeBufferEqual, sha256 } from '../security/crypto.js';
import { hashPassword, validatePassword, verifyPassword } from '../security/password.js';

export class AuthenticationError extends Error {}
export class AuthorizationError extends Error {}
export class ValidationError extends Error {
  constructor(public readonly details: string[]) { super('Validation failed'); }
}

export class AuthService {
  private constructor(
    private readonly repository: AuthRepository,
    private readonly dummyPasswordHash: string,
    private readonly sessionTtlHours: number,
  ) {}

  static async create(repository: AuthRepository, sessionTtlHours: number): Promise<AuthService> {
    const dummyPasswordHash = await hashPassword(randomOpaqueToken(24));
    return new AuthService(repository, dummyPasswordHash, sessionTtlHours);
  }

  async login(input: { identifier: string; password: string; ip?: string; userAgent?: string }): Promise<{
    user: AuthUser; sessionToken: string; csrfToken: string; expiresAt: Date;
  }> {
    const candidate = await this.repository.findLoginCandidate(input.identifier);
    const passwordHash = candidate?.passwordHash ?? this.dummyPasswordHash;
    const passwordValid = await verifyPassword(passwordHash, input.password);
    const locked = candidate?.lockedUntil ? candidate.lockedUntil > new Date() : false;
    const allowed = candidate?.status === 'active' && !locked;

    if (!candidate || !passwordValid || !allowed) {
      if (candidate && candidate.status === 'active' && !locked) {
        await this.repository.recordLoginFailure(candidate.id);
      }
      await this.repository.audit({
        actorId: candidate?.id ?? null,
        action: 'auth.login.failed', targetType: 'session', targetId: null,
        metadata: { reason: 'invalid_credentials' }, ipHash: hashIp(input.ip),
      });
      throw new AuthenticationError('بيانات الدخول غير صحيحة أو الحساب غير متاح.');
    }

    const sessionToken = randomOpaqueToken();
    const csrfToken = randomOpaqueToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlHours * 60 * 60 * 1000);
    const sessionId = await this.repository.createSession({
      userId: candidate.id,
      tokenHash: sha256(sessionToken),
      csrfHash: sha256(csrfToken),
      expiresAt,
      ipHash: hashIp(input.ip),
      userAgent: input.userAgent ?? 'unknown',
    });
    await this.repository.audit({
      actorId: candidate.id, action: 'auth.login.succeeded', targetType: 'session',
      targetId: sessionId, ipHash: hashIp(input.ip),
    });
    return { user: this.toAuthUser(candidate), sessionToken, csrfToken, expiresAt };
  }

  getSession(sessionToken: string): Promise<AuthSession | null> {
    return this.repository.findSession(sha256(sessionToken));
  }

  verifyCsrf(session: AuthSession, csrfToken: string | undefined): boolean {
    if (!csrfToken) return false;
    return safeBufferEqual(session.csrfTokenHash, sha256(csrfToken));
  }

  async logout(session: AuthSession, ip?: string): Promise<void> {
    await this.repository.revokeSession(session.tokenHash);
    await this.repository.audit({
      actorId: session.user.id, action: 'auth.logout', targetType: 'session',
      targetId: session.id, ipHash: hashIp(ip),
    });
  }

  async changeOwnPassword(input: { user: AuthUser; currentPassword: string; newPassword: string; ip?: string }): Promise<void> {
    const candidate = await this.repository.findLoginCandidate(input.user.email);
    if (!candidate || !(await verifyPassword(candidate.passwordHash, input.currentPassword))) {
      throw new AuthenticationError('كلمة المرور الحالية غير صحيحة.');
    }
    const errors = validatePassword(input.newPassword);
    if (errors.length) throw new ValidationError(errors);
    if (await verifyPassword(candidate.passwordHash, input.newPassword)) {
      throw new ValidationError(['يجب أن تختلف كلمة المرور الجديدة عن الحالية.']);
    }
    const passwordHash = await hashPassword(input.newPassword);
    await this.repository.updatePassword(input.user.id, input.user.id, passwordHash);
    await this.repository.audit({
      actorId: input.user.id, action: 'auth.password.changed', targetType: 'user',
      targetId: input.user.id, ipHash: hashIp(input.ip),
    });
  }

  async createUser(input: { actor: AuthUser; email: string; phone: string; displayName: string; role: AppRole; academicLevelId: string | null; password: string; ip?: string }): Promise<string> {
    if (input.actor.role !== 'admin') throw new AuthorizationError('غير مصرح.');
    const errors = validatePassword(input.password);
    if (errors.length) throw new ValidationError(errors);
    const passwordHash = await hashPassword(input.password);
    const userId = await this.repository.createUser({
      actorId: input.actor.id, email: input.email, phone: input.phone, displayName: input.displayName,
      role: input.role, academicLevelId: input.academicLevelId, passwordHash,
    });
    await this.repository.audit({
      actorId: input.actor.id, action: 'admin.user.created', targetType: 'user',
      targetId: userId, metadata: { role: input.role }, ipHash: hashIp(input.ip),
    });
    return userId;
  }

  async updateUser(input: { actor: AuthUser; targetId: string; email: string; phone: string; displayName: string; role: AppRole; academicLevelId: string | null; ip?: string }): Promise<void> {
    if (input.actor.role !== 'admin') throw new AuthorizationError('غير مصرح.');
    await this.repository.updateUser({
      actorId: input.actor.id, targetId: input.targetId, email: input.email,
      phone: input.phone, displayName: input.displayName, role: input.role, academicLevelId: input.academicLevelId,
    });
    await this.repository.audit({
      actorId: input.actor.id, action: 'admin.user.updated', targetType: 'user',
      targetId: input.targetId, metadata: { role: input.role }, ipHash: hashIp(input.ip),
    });
  }

  async setUserStatus(input: { actor: AuthUser; targetId: string; status: 'active' | 'suspended' | 'disabled'; ip?: string }): Promise<void> {
    if (input.actor.role !== 'admin') throw new AuthorizationError('غير مصرح.');
    await this.repository.setUserStatus({ actorId: input.actor.id, targetId: input.targetId, status: input.status });
    await this.repository.audit({
      actorId: input.actor.id, action: 'admin.user.status_changed', targetType: 'user',
      targetId: input.targetId, metadata: { status: input.status }, ipHash: hashIp(input.ip),
    });
  }

  async resetUserPassword(input: { actor: AuthUser; targetId: string; temporaryPassword: string; ip?: string }): Promise<void> {
    if (input.actor.role !== 'admin') throw new AuthorizationError('غير مصرح.');
    const errors = validatePassword(input.temporaryPassword);
    if (errors.length) throw new ValidationError(errors);
    const passwordHash = await hashPassword(input.temporaryPassword);
    await this.repository.resetUserPassword({
      actorId: input.actor.id,
      targetId: input.targetId,
      passwordHash,
      ipHash: hashIp(input.ip),
    });
  }

  private toAuthUser(candidate: { id: string; email: string; phone: string | null; displayName: string; role: AppRole; mustChangePassword: boolean }): AuthUser {
    return {
      id: candidate.id, email: candidate.email, phone: candidate.phone, displayName: candidate.displayName,
      role: candidate.role, mustChangePassword: candidate.mustChangePassword,
    };
  }
}
