import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppRole } from '../domain/auth.js';
import type { AuthService } from '../services/auth-service.js';

export const sessionCookieName = (production: boolean) => production ? '__Host-mc_session' : 'mc_session';
export const csrfCookieName = (production: boolean) => production ? '__Host-mc_csrf' : 'mc_csrf';

export function createAuthHooks(authService: AuthService, production: boolean) {
  const cookieName = sessionCookieName(production);

  async function hydrateSession(request: FastifyRequest): Promise<void> {
    request.authUser = null;
    request.authSession = null;
    const token = request.cookies[cookieName];
    if (!token) return;
    const session = await authService.getSession(token);
    if (!session) return;
    request.authSession = session;
    request.authUser = session.user;
  }

  async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    await hydrateSession(request);
    if (!request.authUser || !request.authSession) {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'يجب تسجيل الدخول أولاً.' } });
    }
  }

  async function requireCsrf(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.authSession || !authService.verifyCsrf(request.authSession, request.headers['x-csrf-token'] as string | undefined)) {
      return reply.code(403).send({ error: { code: 'CSRF_INVALID', message: 'تعذر التحقق من الطلب.' } });
    }
  }

  async function requirePasswordEstablished(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!request.authUser) {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'يجب تسجيل الدخول أولاً.' } });
    }
    if (request.authUser.mustChangePassword) {
      return reply.code(403).send({
        error: { code: 'PASSWORD_CHANGE_REQUIRED', message: 'يجب تغيير كلمة المرور المؤقتة أولاً.' },
      });
    }
  }

  function requireRole(...roles: AppRole[]) {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      if (!request.authUser || !roles.includes(request.authUser.role)) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'ليست لديك صلاحية لتنفيذ هذه العملية.' } });
      }
    };
  }

  return { hydrateSession, requireAuth, requirePasswordEstablished, requireCsrf, requireRole, cookieName };
}
