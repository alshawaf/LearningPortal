import 'fastify';
import type { AuthSession, AuthUser } from '../domain/auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    authUser: AuthUser | null;
    authSession: AuthSession | null;
  }
}
