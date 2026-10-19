import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthService } from '../services/auth-service.js';
import { csrfCookieName, type createAuthHooks } from '../plugins/auth.js';
import { normalizeLoginIdentifier } from '../security/identity.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../security/password.js';

const loginSchema = z.object({
  identifier: z.string().trim().min(3).max(254).transform((value, context) => {
    const normalized = normalizeLoginIdentifier(value);
    if (!normalized) {
      context.addIssue({ code: 'custom', message: 'أدخل بريدًا إلكترونيًا أو رقم جوال صحيحًا.' });
      return z.NEVER;
    }
    return normalized;
  }),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
}).strict();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  newPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
}).strict();

type Hooks = ReturnType<typeof createAuthHooks>;

export async function registerAuthRoutes(app: FastifyInstance, authService: AuthService, hooks: Hooks, production: boolean, ttlHours: number) {
  const csrfName = csrfCookieName(production);
  const cookieOptions = {
    path: '/', httpOnly: true, secure: production, sameSite: 'strict' as const,
    maxAge: ttlHours * 60 * 60,
  };
  const csrfCookieOptions = { ...cookieOptions, httpOnly: false };

  app.post('/login', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
  }, async (request, reply) => {
    const input = loginSchema.parse(request.body);
    const result = await authService.login({
      ...input, ip: request.ip, userAgent: request.headers['user-agent'],
    });
    reply.setCookie(hooks.cookieName, result.sessionToken, cookieOptions);
    reply.setCookie(csrfName, result.csrfToken, csrfCookieOptions);
    return reply.send({ user: result.user, expiresAt: result.expiresAt.toISOString() });
  });

  app.get('/session', { preHandler: hooks.requireAuth }, async (request) => ({
    user: request.authUser,
    expiresAt: request.authSession!.expiresAt.toISOString(),
  }));

  app.post('/logout', { preHandler: [hooks.requireAuth, hooks.requireCsrf] }, async (request, reply) => {
    await authService.logout(request.authSession!, request.ip);
    reply.clearCookie(hooks.cookieName, { path: '/', secure: production, sameSite: 'strict' });
    reply.clearCookie(csrfName, { path: '/', secure: production, sameSite: 'strict' });
    return reply.code(204).send();
  });

  app.post('/change-password', { preHandler: [hooks.requireAuth, hooks.requireCsrf] }, async (request, reply) => {
    const input = changePasswordSchema.parse(request.body);
    await authService.changeOwnPassword({ user: request.authUser!, ...input, ip: request.ip });
    reply.clearCookie(hooks.cookieName, { path: '/', secure: production, sameSite: 'strict' });
    reply.clearCookie(csrfName, { path: '/', secure: production, sameSite: 'strict' });
    return reply.send({ message: 'تم تغيير كلمة المرور. سجّل الدخول مجددًا.' });
  });
}
