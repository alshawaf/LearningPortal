import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createAuthHooks } from '../plugins/auth.js';
import { StudentActivityRepository } from '../repositories/student-activity-repository.js';

const listQuery = z.object({ offeringId: z.string().uuid().optional() }).strict();
const studentParams = z.object({ studentId: z.string().uuid() });
type Hooks = ReturnType<typeof createAuthHooks>;

export async function registerStudentActivityRoutes(app: FastifyInstance, repository: StudentActivityRepository, hooks: Hooks) {
  const manager = [hooks.requireAuth, hooks.requirePasswordEstablished, hooks.requireRole('admin', 'instructor')];

  app.get('/', { preHandler: manager }, async (request) => {
    const query = listQuery.parse(request.query);
    return repository.list(request.authUser!, query.offeringId ?? null);
  });

  app.get('/:studentId', { preHandler: manager }, async (request) => {
    const { studentId } = studentParams.parse(request.params);
    const query = listQuery.parse(request.query);
    return repository.detail(request.authUser!, studentId, query.offeringId ?? null);
  });
}
