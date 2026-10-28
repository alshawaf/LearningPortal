import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withUserContext } from '../db/pool.js';
import type { AuthService } from '../services/auth-service.js';
import type { createAuthHooks } from '../plugins/auth.js';
import { normalizePhone } from '../security/identity.js';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../security/password.js';

const phoneSchema = z.string().trim().min(8).max(32).transform((value, context) => {
  const normalized = normalizePhone(value);
  if (!normalized) {
    context.addIssue({ code: 'custom', message: 'أدخل رقمًا دوليًا صحيحًا، مثل +967777123456.' });
    return z.NEVER;
  }
  return normalized;
});

const createUserSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.trim().toLowerCase()),
  phone: phoneSchema,
  displayName: z.string().trim().min(2).max(120),
  role: z.enum(['admin', 'instructor', 'student']),
  academicLevelId: z.string().uuid().nullable(),
  temporaryPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
}).strict().superRefine((value, context) => {
  if (value.role === 'student' && !value.academicLevelId) context.addIssue({ code: 'custom', path: ['academicLevelId'], message: 'المستوى الأكاديمي مطلوب للطالب.' });
  if (value.role !== 'student' && value.academicLevelId) context.addIssue({ code: 'custom', path: ['academicLevelId'], message: 'المستوى الأكاديمي مخصص للطلاب فقط.' });
});

const userParamsSchema = z.object({ userId: z.string().uuid() }).strict();
const updateUserSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.trim().toLowerCase()),
  phone: phoneSchema,
  displayName: z.string().trim().min(2).max(120),
  role: z.enum(['admin', 'instructor', 'student']),
  academicLevelId: z.string().uuid().nullable(),
}).strict().superRefine((value, context) => {
  if (value.role === 'student' && !value.academicLevelId) context.addIssue({ code: 'custom', path: ['academicLevelId'], message: 'المستوى الأكاديمي مطلوب للطالب.' });
  if (value.role !== 'student' && value.academicLevelId) context.addIssue({ code: 'custom', path: ['academicLevelId'], message: 'المستوى الأكاديمي مخصص للطلاب فقط.' });
});
const updateStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'disabled']),
}).strict();
const resetPasswordSchema = z.object({
  temporaryPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
  confirmPassword: z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH),
}).strict().superRefine((value, context) => {
  if (value.temporaryPassword !== value.confirmPassword) {
    context.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'كلمتا المرور غير متطابقتين.' });
  }
});
const auditQuerySchema = z.object({
  action: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
}).strict();

type Hooks = ReturnType<typeof createAuthHooks>;

export async function registerAdminRoutes(app: FastifyInstance, authService: AuthService, hooks: Hooks) {
  const adminGuards = [hooks.requireAuth, hooks.requirePasswordEstablished, hooks.requireRole('admin')];

  app.get('/users', { preHandler: adminGuards }, async (request) => {
    const users = await withUserContext(request.authUser!, async (client) => {
      const result = await client.query(
        `select u.id, u.email, u.phone_e164, u.display_name, u.role, u.status, u.last_login_at, u.created_at,
                l.id as level_id, l.name as level_name, s.id as specialization_id, s.name as specialization_name,
                d.id as department_id, d.name as department_name
         from app.users u
         left join app.academic_levels l on l.id = u.academic_level_id
         left join app.specializations s on s.id = l.specialization_id
         left join app.academic_departments d on d.id = s.department_id
         order by u.created_at desc limit 200`,
      );
      return result.rows.map((row) => ({
        id: row.id, email: row.email, phone: row.phone_e164, displayName: row.display_name, role: row.role,
        status: row.status, lastLoginAt: row.last_login_at, createdAt: row.created_at,
        levelId: row.level_id, levelName: row.level_name, specializationId: row.specialization_id,
        specializationName: row.specialization_name, departmentId: row.department_id, departmentName: row.department_name,
      }));
    });
    return { users };
  });

  app.get('/audit', { preHandler: adminGuards }, async (request) => {
    const query = auditQuerySchema.parse(request.query);
    return withUserContext(request.authUser!, async (client) => {
      const result = await client.query(
        `select a.id, a.action, a.target_type, a.target_id, a.created_at,
                u.display_name as actor_name
         from app.audit_logs a
         left join app.users u on u.id=a.actor_user_id
         where ($1::text is null or a.action ilike '%' || $1 || '%')
         order by a.created_at desc, a.id desc limit $2 offset $3`,
        [query.action || null, query.limit, query.offset],
      );
      return { entries: result.rows.map((row) => ({
        id: String(row.id), action: row.action, targetType: row.target_type, targetId: row.target_id,
        createdAt: row.created_at, actorName: row.actor_name || 'النظام',
      })) };
    });
  });

  app.post('/users', { preHandler: [...adminGuards, hooks.requireCsrf] }, async (request, reply) => {
    const input = createUserSchema.parse(request.body);
    const userId = await authService.createUser({
      actor: request.authUser!, email: input.email, phone: input.phone, displayName: input.displayName,
      role: input.role, academicLevelId: input.academicLevelId, password: input.temporaryPassword, ip: request.ip,
    });
    return reply.code(201).send({ id: userId });
  });

  app.patch('/users/:userId', { preHandler: [...adminGuards, hooks.requireCsrf] }, async (request) => {
    const { userId } = userParamsSchema.parse(request.params);
    const input = updateUserSchema.parse(request.body);
    await authService.updateUser({ actor: request.authUser!, targetId: userId, ...input, ip: request.ip });
    return { message: 'تم تحديث بيانات الحساب.' };
  });

  app.patch('/users/:userId/status', { preHandler: [...adminGuards, hooks.requireCsrf] }, async (request) => {
    const { userId } = userParamsSchema.parse(request.params);
    const { status } = updateStatusSchema.parse(request.body);
    await authService.setUserStatus({ actor: request.authUser!, targetId: userId, status, ip: request.ip });
    return { message: 'تم تحديث حالة الحساب.' };
  });

  app.patch('/users/:userId/password', {
    preHandler: [...adminGuards, hooks.requireCsrf],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const { userId } = userParamsSchema.parse(request.params);
    const input = resetPasswordSchema.parse(request.body);
    await authService.resetUserPassword({
      actor: request.authUser!, targetId: userId,
      temporaryPassword: input.temporaryPassword, ip: request.ip,
    });
    return { message: 'تمت إعادة تعيين كلمة المرور وإبطال جلسات المستخدم.' };
  });
}
