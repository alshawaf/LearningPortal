import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createAuthHooks } from '../plugins/auth.js';
import { CourseRepository } from '../repositories/course-repository.js';

const courseSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,24}$/),
  title: z.string().trim().min(3).max(180),
}).strict();

const courseParams = z.object({ courseId: z.string().uuid() });
const courseStatusSchema = z.object({ isActive: z.boolean() }).strict();

type Hooks = ReturnType<typeof createAuthHooks>;

export async function registerCourseRoutes(app: FastifyInstance, repository: CourseRepository, hooks: Hooks) {
  const authenticated = [hooks.requireAuth, hooks.requirePasswordEstablished];

  app.get('/', { preHandler: authenticated }, async (request) => ({ courses: await repository.list(request.authUser!) }));
  app.get('/catalog', { preHandler: [...authenticated, hooks.requireRole('admin')] }, async (request) => ({ courses: await repository.listCatalog(request.authUser!) }));

  app.post('/', { preHandler: [...authenticated, hooks.requireRole('admin'), hooks.requireCsrf] }, async (request, reply) => {
    const course = await repository.create(request.authUser!, courseSchema.parse(request.body));
    return reply.code(201).send({ course });
  });

  app.patch('/:courseId', { preHandler: [...authenticated, hooks.requireRole('admin'), hooks.requireCsrf] }, async (request) => {
    const { courseId } = courseParams.parse(request.params);
    await repository.update(request.authUser!, courseId, courseSchema.parse(request.body));
    return { message: 'تم تحديث بيانات المقرر.' };
  });

  app.patch('/:courseId/status', { preHandler: [...authenticated, hooks.requireRole('admin'), hooks.requireCsrf] }, async (request) => {
    const { courseId } = courseParams.parse(request.params);
    const { isActive } = courseStatusSchema.parse(request.body);
    await repository.setStatus(request.authUser!, courseId, isActive);
    return { message: isActive ? 'تم تفعيل المقرر.' : 'تم إيقاف المقرر.' };
  });

}
