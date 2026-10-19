import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { config } from '../config.js';
import { runPython } from '../services/practice-runner.js';
import { PracticeRunnerError, type RunnerCase } from '../services/practice-runner-contracts.js';

type ExecutionBody = {
  source: string;
  mode: 'stdin' | 'function';
  functionName: string | null;
  comparisonMode?: 'auto' | 'exact' | 'flexible';
  ignoreCase?: boolean;
  whitespaceMode?: 'exact' | 'normalize' | 'remove';
  suppressInputPrompts?: boolean;
  tests: RunnerCase[];
};

class ExecutionGate {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= config.runnerMaxConcurrency) {
      if (this.waiting.length >= config.runnerMaxQueue) throw new PracticeRunnerError('طابور التنفيذ ممتلئ مؤقتاً. حاول لاحقاً.');
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try { return await work(); }
    finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  status() { return { active: this.active, queued: this.waiting.length, capacity: config.runnerMaxConcurrency }; }
}

function validSecret(header: string | undefined): boolean {
  if (!header?.startsWith('Bearer ')) return false;
  const provided = Buffer.from(header.slice(7));
  const expected = Buffer.from(config.practiceRunnerSharedSecret);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function validateBody(value: unknown): ExecutionBody {
  const body = value as Partial<ExecutionBody> | null;
  if (!body || typeof body.source !== 'string' || body.source.length < 1 || body.source.length > 100_000) throw new PracticeRunnerError('شفرة التنفيذ غير صالحة.', false);
  if (body.mode !== 'stdin' && body.mode !== 'function') throw new PracticeRunnerError('نمط التنفيذ غير صالح.', false);
  if (!Array.isArray(body.tests) || body.tests.length < 1 || body.tests.length > 50) throw new PracticeRunnerError('حالات الاختبار غير صالحة.', false);
  for (const test of body.tests) {
    if (!test || typeof test.id !== 'string' || test.id.length > 100 || typeof test.isHidden !== 'boolean'
      || !Number.isInteger(test.timeLimitMs) || test.timeLimitMs < 100 || test.timeLimitMs > 10_000
      || typeof test.inputPayload !== 'object' || typeof test.expectedPayload !== 'object') {
      throw new PracticeRunnerError('إحدى حالات الاختبار غير صالحة.', false);
    }
  }
  return body as ExecutionBody;
}

export async function buildRunnerApp() {
  const app = Fastify({ logger: { level: config.isProduction ? 'info' : 'debug', redact: ['req.headers.authorization', 'req.body.source'] }, bodyLimit: 1_048_576 });
  const gate = new ExecutionGate();
  await app.register(helmet);
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health') return;
    if (!validSecret(request.headers.authorization)) return reply.code(401).send({ error: { message: 'غير مصرح.' } });
  });
  app.get('/health', async () => ({ status: 'ok', ...gate.status() }));
  app.post('/v1/execute/python', async (request, reply) => {
    try {
      const input = validateBody(request.body);
      const result = await gate.run(() => runPython(input));
      return { result };
    } catch (error) {
      const runnerError = error instanceof PracticeRunnerError ? error : new PracticeRunnerError('فشل تنفيذ الحل.');
      return reply.code(runnerError.isInfrastructureFailure ? 503 : 400).send({ error: { message: runnerError.message, infrastructure: runnerError.isInfrastructureFailure } });
    }
  });
  return app;
}
