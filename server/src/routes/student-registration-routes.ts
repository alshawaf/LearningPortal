import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createAuthHooks } from '../plugins/auth.js';
import { normalizePhone } from '../security/identity.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../security/password.js';
import type { StudentRegistrationService } from '../services/student-registration-service.js';

const phoneSchema = z.string().trim().min(8).max(32).transform((value, context) => {
  const normalized = normalizePhone(value);
  if (!normalized) {
    context.addIssue({ code: 'custom', message: 'أدخل رقم جوال صحيحًا بصيغة دولية.' });
    return z.NEVER;
  }
  return normalized;
});
const studentNumberSchema = z.string().trim().max(32).transform((value) => value ? value.toUpperCase() : null)
  .refine((value) => value === null || /^[A-Z0-9_-]{3,32}$/.test(value), 'الرقم الجامعي يجب أن يتكون من حروف أو أرقام فقط.');
const registrationFields = {
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: phoneSchema,
  displayName: z.string().trim().min(2).max(120),
  studentNumber: studentNumberSchema,
  academicLevelId: z.string().uuid(),
};
const registrationSchema = z.object({
  ...registrationFields,
  password: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  confirmPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
}).strict().superRefine((value, context) => {
  if (value.password !== value.confirmPassword) context.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'كلمتا المرور غير متطابقتين.' });
});
const requestParams = z.object({ requestId: z.string().uuid() }).strict();
const updateSchema = z.object(registrationFields).strict();
const decisionSchema = z.object({
  decision: z.enum(['approved', 'rejected', 'changes_requested']),
  reason: z.string().trim().max(500).nullable(),
  sectionId: z.string().uuid().nullable(),
}).strict().superRefine((value, context) => {
  if (value.decision !== 'approved' && (!value.reason || value.reason.length < 3)) {
    context.addIssue({ code: 'custom', path: ['reason'], message: 'اكتب سببًا واضحًا للقرار.' });
  }
  if (value.decision === 'approved' && !value.sectionId) context.addIssue({ code: 'custom', path: ['sectionId'], message: 'اختر الشعبة التي سينضم إليها الطالب.' });
});

type Hooks = ReturnType<typeof createAuthHooks>;

export async function registerStudentRegistrationRoutes(
  app: FastifyInstance, service: StudentRegistrationService, hooks: Hooks, production: boolean,
) {
  const cookieName = production ? '__Host-mc_registration' : 'mc_registration';
  const cookieOptions = { path: '/', httpOnly: true, secure: production, sameSite: 'strict' as const, maxAge: 30 * 24 * 60 * 60 };
  const adminGuards = [hooks.requireAuth, hooks.requirePasswordEstablished, hooks.requireRole('admin')];

  app.get('/options', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () => ({
    departments: await service.options(),
  }));

  app.post('/', { config: { rateLimit: { max: 3, timeWindow: '1 hour' } } }, async (request, reply) => {
    const input = registrationSchema.parse(request.body);
    const result = await service.submit({ ...input, ip: request.ip });
    reply.setCookie(cookieName, result.trackingToken, cookieOptions);
    return reply.code(201).send({ id: result.requestId, status: 'pending', message: 'تم استلام طلب التسجيل بنجاح.' });
  });

  app.get('/status', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const token = request.cookies[cookieName];
    if (!token) return reply.code(401).send({ error: { code: 'REGISTRATION_TRACKING_REQUIRED', message: 'لا توجد جلسة لمتابعة طلب التسجيل.' } });
    const registration = await service.status(token);
    if (!registration) return reply.code(404).send({ error: { code: 'REGISTRATION_NOT_FOUND', message: 'تعذر العثور على طلب التسجيل.' } });
    return { registration };
  });

  app.get('/admin', { preHandler: adminGuards }, async (request) => {
    const [requests, sections] = await Promise.all([service.list(request.authUser!), service.sections(request.authUser!)]);
    return { requests, sections };
  });

  app.patch('/admin/:requestId', { preHandler: [...adminGuards, hooks.requireCsrf] }, async (request) => {
    const { requestId } = requestParams.parse(request.params);
    await service.update(request.authUser!, requestId, updateSchema.parse(request.body));
    return { message: 'تم تحديث بيانات طلب التسجيل.' };
  });

  app.post('/admin/:requestId/decision', { preHandler: [...adminGuards, hooks.requireCsrf] }, async (request) => {
    const { requestId } = requestParams.parse(request.params);
    const input = decisionSchema.parse(request.body);
    const approvedUserId = await service.decide(request.authUser!, requestId, input.decision, input.reason, input.sectionId);
    return { message: input.decision === 'approved' ? 'تمت الموافقة وتفعيل حساب الطالب.' : 'تم حفظ قرار المراجعة.', approvedUserId };
  });
}
