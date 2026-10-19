export type AppRole = 'admin' | 'instructor' | 'student';

export type AuthUser = {
  id: string;
  email: string;
  phone: string | null;
  displayName: string;
  role: AppRole;
  mustChangePassword: boolean;
};

export type AuthSession = {
  id: string;
  user: AuthUser;
  csrfTokenHash: Buffer;
  expiresAt: Date;
  tokenHash: Buffer;
};

export type LoginCandidate = AuthUser & {
  status: 'active' | 'suspended' | 'disabled';
  passwordHash: string;
  failedLoginAttempts: number;
  lockedUntil: Date | null;
};
