import type { AuthUser } from '../domain/auth.js';
import { StudentRegistrationRepository } from '../repositories/student-registration-repository.js';
import { hashIp, randomOpaqueToken, sha256 } from '../security/crypto.js';
import { hashPassword, validatePassword } from '../security/password.js';
import { AuthorizationError, ValidationError } from './auth-service.js';

export class StudentRegistrationService {
  constructor(private readonly repository: StudentRegistrationRepository) {}

  options() { return this.repository.options(); }

  async submit(input: {
    email: string; phone: string; displayName: string; studentNumber: string | null;
    academicLevelId: string; password: string; ip?: string;
  }) {
    const passwordErrors = validatePassword(input.password);
    if (passwordErrors.length) throw new ValidationError(passwordErrors);
    const [passwordHash, trackingToken] = await Promise.all([
      hashPassword(input.password), Promise.resolve(randomOpaqueToken()),
    ]);
    const requestId = await this.repository.create({
      ...input, passwordHash, trackingTokenHash: sha256(trackingToken), ipHash: hashIp(input.ip),
    });
    return { requestId, trackingToken };
  }

  status(trackingToken: string) { return this.repository.status(sha256(trackingToken)); }

  list(actor: AuthUser) {
    if (actor.role !== 'admin') throw new AuthorizationError('غير مصرح.');
    return this.repository.list(actor);
  }

  sections(actor: AuthUser) {
    if (actor.role !== 'admin') throw new AuthorizationError('غير مصرح.');
    return this.repository.listEligibleSections(actor);
  }

  update(actor: AuthUser, requestId: string, input: {
    email: string; phone: string; displayName: string; studentNumber: string | null; academicLevelId: string;
  }) {
    if (actor.role !== 'admin') throw new AuthorizationError('غير مصرح.');
    return this.repository.update(actor, requestId, input);
  }

  decide(actor: AuthUser, requestId: string, decision: 'approved' | 'rejected' | 'changes_requested', reason: string | null, sectionId: string | null) {
    if (actor.role !== 'admin') throw new AuthorizationError('غير مصرح.');
    return this.repository.decide(actor, requestId, decision, reason, sectionId);
  }
}
