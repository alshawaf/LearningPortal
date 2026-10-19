import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createAuthHooks } from '../plugins/auth.js';
import { CourseRepository } from '../repositories/course-repository.js';

type Hooks = ReturnType<typeof createAuthHooks>;
const assignmentParams = z.object({ assignmentId: z.string().uuid() });
const submissionSchema = z.object({ sourceCode: z.string().min(1).max(100_000) }).strict();

export async function registerPlatformRoutes(app: FastifyInstance, repository: CourseRepository, hooks: Hooks) {
  const authenticated = [hooks.requireAuth, hooks.requirePasswordEstablished];

  app.get('/assignments', { preHandler: authenticated }, async (request) => ({
    assignments: await repository.listAssignments(request.authUser!),
  }));

  app.get('/assignments/:assignmentId/submissions', { preHandler: authenticated }, async (request) => {
    const { assignmentId } = assignmentParams.parse(request.params);
    return { submissions: await repository.listSubmissions(request.authUser!, assignmentId) };
  });

  app.post('/assignments/:assignmentId/submissions', {
    preHandler: [...authenticated, hooks.requireRole('student'), hooks.requireCsrf],
  }, async (request, reply) => {
    const { assignmentId } = assignmentParams.parse(request.params);
    const { sourceCode } = submissionSchema.parse(request.body);
    const submission = await repository.submit(request.authUser!, assignmentId, sourceCode);
    return reply.code(201).send({ submission });
  });

  app.get('/people', {
    preHandler: [...authenticated, hooks.requireRole('admin', 'instructor')],
  }, async (request) => ({ people: await repository.listPeople(request.authUser!) }));
}
