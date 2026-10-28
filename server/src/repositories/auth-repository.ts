import type { Pool } from 'pg';
import type { AppRole, AuthSession, LoginCandidate } from '../domain/auth.js';
import { withUserContext } from '../db/pool.js';

type LoginRow = {
  user_id: string;
  email: string;
  phone_e164: string | null;
  display_name: string;
  role: AppRole;
  status: LoginCandidate['status'];
  password_hash: string;
  failed_login_attempts: number;
  locked_until: Date | null;
  must_change_password: boolean;
};

type SessionRow = {
  session_id: string;
  user_id: string;
  email: string;
  phone_e164: string | null;
  display_name: string;
  role: AppRole;
  csrf_token_hash: Buffer;
  expires_at: Date;
  must_change_password: boolean;
};

export class AuthRepository {
  constructor(private readonly db: Pool) {}

  async findLoginCandidate(identifier: string): Promise<LoginCandidate | null> {
    const result = await this.db.query<LoginRow>('select * from app.auth_login_candidate($1)', [identifier]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.user_id, email: row.email, phone: row.phone_e164, displayName: row.display_name, role: row.role,
      status: row.status, passwordHash: row.password_hash,
      failedLoginAttempts: row.failed_login_attempts, lockedUntil: row.locked_until,
      mustChangePassword: row.must_change_password,
    };
  }

  async recordLoginFailure(userId: string): Promise<void> {
    await this.db.query('select app.auth_record_failure($1)', [userId]);
  }

  async createSession(input: {
    userId: string; tokenHash: Buffer; csrfHash: Buffer; expiresAt: Date;
    ipHash: Buffer | null; userAgent: string;
  }): Promise<string> {
    const result = await this.db.query<{ auth_register_session: string }>(
      'select app.auth_register_session($1, $2, $3, $4, $5, $6)',
      [input.userId, input.tokenHash, input.csrfHash, input.expiresAt, input.ipHash, input.userAgent],
    );
    return result.rows[0]!.auth_register_session;
  }

  async findSession(tokenHash: Buffer): Promise<AuthSession | null> {
    const result = await this.db.query<SessionRow>('select * from app.auth_get_session($1)', [tokenHash]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.session_id,
      tokenHash,
      csrfTokenHash: row.csrf_token_hash,
      expiresAt: row.expires_at,
      user: {
        id: row.user_id, email: row.email, phone: row.phone_e164, displayName: row.display_name,
        role: row.role, mustChangePassword: row.must_change_password,
      },
    };
  }

  async revokeSession(tokenHash: Buffer): Promise<void> {
    await this.db.query('select app.auth_revoke_session($1)', [tokenHash]);
  }

  async updatePassword(actorId: string, targetId: string, passwordHash: string): Promise<void> {
    await this.db.query('select app.auth_update_password($1, $2, $3)', [actorId, targetId, passwordHash]);
  }

  async createUser(input: { actorId: string; email: string; phone: string; displayName: string; role: AppRole; academicLevelId: string | null; passwordHash: string }): Promise<string> {
    return withUserContext({ id: input.actorId, role: 'admin' }, async (client) => {
      const result = await client.query<{ admin_create_user: string }>(
        'select app.admin_create_user($1, $2, $3, $4, $5, $6, $7, true)',
        [input.actorId, input.email, input.phone, input.displayName, input.role, input.academicLevelId, input.passwordHash],
      );
      return result.rows[0]!.admin_create_user;
    });
  }

  async updateUser(input: { actorId: string; targetId: string; email: string; phone: string; displayName: string; role: AppRole; academicLevelId: string | null }): Promise<void> {
    await withUserContext({ id: input.actorId, role: 'admin' }, async (client) => {
      await client.query('select app.admin_update_user($1, $2, $3, $4, $5, $6, $7)', [
        input.actorId, input.targetId, input.email, input.phone, input.displayName, input.role, input.academicLevelId,
      ]);
    });
  }

  async setUserStatus(input: { actorId: string; targetId: string; status: LoginCandidate['status'] }): Promise<void> {
    await withUserContext({ id: input.actorId, role: 'admin' }, async (client) => {
      await client.query('select app.admin_set_user_status($1, $2, $3)', [input.actorId, input.targetId, input.status]);
    });
  }

  async resetUserPassword(input: { actorId: string; targetId: string; passwordHash: string; ipHash: Buffer | null }): Promise<void> {
    await withUserContext({ id: input.actorId, role: 'admin' }, async (client) => {
      await client.query('select app.admin_reset_user_password($1, $2, $3)', [input.actorId, input.targetId, input.passwordHash]);
      await client.query('select app.write_audit($1, $2, $3, $4, $5::jsonb, $6)', [
        input.actorId, 'admin.user.password_reset', 'user', input.targetId,
        JSON.stringify({ sessionsRevoked: true, mustChangePassword: true }), input.ipHash,
      ]);
    });
  }

  async audit(input: { actorId: string | null; action: string; targetType: string; targetId: string | null; metadata?: object; ipHash: Buffer | null }): Promise<void> {
    await this.db.query('select app.write_audit($1, $2, $3, $4, $5::jsonb, $6)', [
      input.actorId, input.action, input.targetType, input.targetId,
      JSON.stringify(input.metadata ?? {}), input.ipHash,
    ]);
  }
}
