import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createAuthHooks } from '../plugins/auth.js';
import { AcademicStructureRepository } from '../repositories/academic-structure-repository.js';

const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,24}$/);
const nameSchema = z.string().trim().min(2).max(160);
const entitySchema = z.object({ code: codeSchema, name: nameSchema }).strict();
const departmentParams = z.object({ departmentId: z.string().uuid() }).strict();
const specializationParams = z.object({ specializationId: z.string().uuid() }).strict();
const levelParams = z.object({ levelId: z.string().uuid() }).strict();
const levelSchema = z.object({ number: z.number().int().min(1).max(20), name: z.string().trim().min(2).max(120) }).strict();

type Hooks = ReturnType<typeof createAuthHooks>;

export async function registerAcademicStructureRoutes(app: FastifyInstance, repository: AcademicStructureRepository, hooks: Hooks) {
  const authenticated = [hooks.requireAuth, hooks.requirePasswordEstablished];
  const adminGuards = [...authenticated, hooks.requireRole('admin'), hooks.requireCsrf];

  app.get('/', { preHandler: authenticated }, async (request) => ({ departments: await repository.list(request.authUser!) }));

  app.post('/departments', { preHandler: adminGuards }, async (request, reply) => {
    const department = await repository.createDepartment(request.authUser!, entitySchema.parse(request.body));
    return reply.code(201).send({ department });
  });

  app.post('/departments/:departmentId/specializations', { preHandler: adminGuards }, async (request, reply) => {
    const { departmentId } = departmentParams.parse(request.params);
    const specialization = await repository.createSpecialization(request.authUser!, departmentId, entitySchema.parse(request.body));
    return reply.code(201).send({ specialization });
  });

  app.post('/specializations/:specializationId/levels', { preHandler: adminGuards }, async (request, reply) => {
    const { specializationId } = specializationParams.parse(request.params);
    const level = await repository.createLevel(request.authUser!, specializationId, levelSchema.parse(request.body));
    return reply.code(201).send({ level });
  });

  app.patch('/departments/:departmentId', { preHandler: adminGuards }, async (request) => {
    const { departmentId } = departmentParams.parse(request.params);
    await repository.updateDepartment(request.authUser!, departmentId, entitySchema.parse(request.body));
    return { message: 'تم تحديث بيانات الدائرة.' };
  });

  app.patch('/specializations/:specializationId', { preHandler: adminGuards }, async (request) => {
    const { specializationId } = specializationParams.parse(request.params);
    await repository.updateSpecialization(request.authUser!, specializationId, entitySchema.parse(request.body));
    return { message: 'تم تحديث بيانات التخصص.' };
  });

  app.patch('/levels/:levelId', { preHandler: adminGuards }, async (request) => {
    const { levelId } = levelParams.parse(request.params);
    await repository.updateLevel(request.authUser!, levelId, levelSchema.parse(request.body));
    return { message: 'تم تحديث بيانات المستوى.' };
  });
}
