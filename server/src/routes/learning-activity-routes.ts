import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createAuthHooks } from '../plugins/auth.js';
import { LearningActivityRepository } from '../repositories/learning-activity-repository.js';

type Hooks = ReturnType<typeof createAuthHooks>;
const querySchema = z.object({ offeringId: z.string().uuid().optional() }).strict();

export async function registerLearningActivityRoutes(app: FastifyInstance, repository: LearningActivityRepository, hooks: Hooks) {
  app.get('/', { preHandler: [hooks.requireAuth, hooks.requirePasswordEstablished] }, async (request) => ({
    activities: await repository.list(request.authUser!, querySchema.parse(request.query).offeringId),
  }));
}
