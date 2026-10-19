import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { createAuthHooks } from '../plugins/auth.js';
import { PracticeRepository, type ExerciseInput } from '../repositories/practice-repository.js';
import { generateExpectedPayloads, runPython } from '../services/practice-execution-client.js';
import { PracticeRunnerError, type RunnerCase, type RunnerResult } from '../services/practice-runner-contracts.js';

const exerciseParams = z.object({ exerciseId: z.string().uuid() });
const studentParams = z.object({ exerciseId: z.string().uuid(), studentId: z.string().uuid() });
const attemptParams = z.object({ exerciseId: z.string().uuid(), attemptId: z.string().uuid() });
const sourceSchema = z.object({ sourceCode: z.string().min(1).max(100_000) }).strict();
const statusSchema = z.object({ status: z.enum(['published', 'archived']) }).strict();
const baseTestSchema = z.object({
  isHidden: z.boolean(),
  timeLimitMs: z.number().int().min(100).max(10_000).default(2_000),
});
const stdinTestSchema = baseTestSchema.extend({
  inputPayload: z.object({ stdin: z.string().max(20_000) }).strict(),
  expectedPayload: z.object({ stdout: z.string().max(20_000) }).strict().default({ stdout: '' }),
}).strict();
const functionTestSchema = baseTestSchema.extend({
  inputPayload: z.object({ arguments: z.array(z.unknown()).max(50) }).strict(),
  expectedPayload: z.object({ return: z.unknown() }).strict().default({ return: null }),
}).strict();
const exerciseBase = z.object({
  offeringId: z.string().uuid(),
  title: z.string().trim().min(3).max(180),
  description: z.string().trim().min(10).max(20_000),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  points: z.number().int().min(1).max(1_000),
  starterCode: z.string().max(100_000),
  referenceSolution: z.string().min(1).max(100_000),
  comparisonMode: z.enum(['auto', 'exact', 'flexible']).default('auto'),
  ignoreCase: z.boolean().default(false),
  whitespaceMode: z.enum(['exact', 'normalize', 'remove']).default('exact'),
  suppressInputPrompts: z.boolean().default(true),
  autoGenerateExpected: z.boolean().default(true),
});
const exerciseSchema = z.discriminatedUnion('executionMode', [
  exerciseBase.extend({ executionMode: z.literal('stdin'), functionName: z.null(), tests: z.array(stdinTestSchema).min(2).max(50) }).strict(),
  exerciseBase.extend({
    executionMode: z.literal('function'),
    functionName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/),
    tests: z.array(functionTestSchema).min(2).max(50),
  }).strict(),
]).superRefine((value, context) => {
  if (!value.tests.some((test) => !test.isHidden)) context.addIssue({ code: 'custom', path: ['tests'], message: 'يجب إضافة حالة اختبار ظاهرة واحدة على الأقل.' });
  if (!value.tests.some((test) => test.isHidden)) context.addIssue({ code: 'custom', path: ['tests'], message: 'يجب إضافة حالة اختبار مخفية واحدة على الأقل.' });
  if (value.comparisonMode !== 'flexible' && (value.ignoreCase || value.whitespaceMode !== 'exact')) {
    context.addIssue({ code: 'custom', path: ['comparisonMode'], message: 'لا يمكن جمع التقييم التلقائي أو المطابقة التامة مع قواعد تحقق يدوية.' });
  }
  if (value.comparisonMode === 'flexible' && !value.ignoreCase && value.whitespaceMode === 'exact') {
    context.addIssue({ code: 'custom', path: ['comparisonMode'], message: 'اختر قاعدة تحقق مرنة واحدة على الأقل.' });
  }
});
const previewSchema = z.discriminatedUnion('executionMode', [
  z.object({
    executionMode: z.literal('stdin'), functionName: z.null(), referenceSolution: z.string().min(1).max(100_000),
    suppressInputPrompts: z.boolean().default(true), tests: z.array(stdinTestSchema).min(1).max(50),
  }).strict(),
  z.object({
    executionMode: z.literal('function'), functionName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}$/),
    referenceSolution: z.string().min(1).max(100_000), suppressInputPrompts: z.boolean().default(true),
    tests: z.array(functionTestSchema).min(1).max(50),
  }).strict(),
]);

type Hooks = ReturnType<typeof createAuthHooks>;

export async function registerPracticeRoutes(app: FastifyInstance, repository: PracticeRepository, hooks: Hooks) {
  const authenticated = [hooks.requireAuth, hooks.requirePasswordEstablished];
  const manager = [...authenticated, hooks.requireRole('admin', 'instructor')];
  const student = [...authenticated, hooks.requireRole('student')];

  app.get('/', { preHandler: authenticated }, async (request) => {
    const [exercises, stats] = await Promise.all([repository.list(request.authUser!), repository.studentStats(request.authUser!)]);
    return { exercises, stats };
  });

  app.post('/preview', {
    preHandler: [...manager, hooks.requireCsrf],
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
  }, async (request) => {
    const input = previewSchema.parse(request.body);
    const outputs = await generateExpectedPayloads({
      source: input.referenceSolution,
      mode: input.executionMode,
      functionName: input.functionName,
      suppressInputPrompts: input.suppressInputPrompts,
      tests: input.tests.map((test, index) => ({
        id: `preview-${index + 1}`, inputPayload: test.inputPayload, isHidden: test.isHidden, timeLimitMs: test.timeLimitMs,
      })),
    });
    return { outputs };
  });

  app.get('/:exerciseId', { preHandler: authenticated }, async (request, reply) => {
    const { exerciseId } = exerciseParams.parse(request.params);
    const exercise = await repository.get(request.authUser!, exerciseId);
    if (!exercise) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'التدريب غير موجود.' } });
    return { exercise };
  });

  app.get('/:exerciseId/students', { preHandler: manager }, async (request) => {
    const { exerciseId } = exerciseParams.parse(request.params);
    return repository.listStudents(request.authUser!, exerciseId);
  });

  app.get('/:exerciseId/students/:studentId/attempts', { preHandler: manager }, async (request) => {
    const { exerciseId, studentId } = studentParams.parse(request.params);
    return repository.listStudentAttempts(request.authUser!, exerciseId, studentId);
  });

  app.get('/:exerciseId/attempts/:attemptId', { preHandler: manager }, async (request) => {
    const { exerciseId, attemptId } = attemptParams.parse(request.params);
    return { attempt: await repository.getAttempt(request.authUser!, exerciseId, attemptId) };
  });

  app.post('/', { preHandler: [...manager, hooks.requireCsrf] }, async (request, reply) => {
    const input = await hydrateExpectedOutputs(exerciseSchema.parse(request.body) as ExerciseInput);
    const id = await repository.create(request.authUser!, input);
    return reply.code(201).send({ id, message: 'تم إنشاء التدريب كمسودة.' });
  });

  app.patch('/:exerciseId', { preHandler: [...manager, hooks.requireCsrf] }, async (request) => {
    const { exerciseId } = exerciseParams.parse(request.params);
    const input = await hydrateExpectedOutputs(exerciseSchema.parse(request.body) as ExerciseInput);
    const existing = await repository.get(request.authUser!, exerciseId);
    if (!existing) return replyNotFound();
    if (existing.status === 'published') {
      if (input.offeringId !== existing.offeringId) {
        const error = new Error('لا يمكن نقل تدريب منشور إلى مقرر آخر حفاظاً على عزل المحاولات والطلاب.') as Error & { code: string };
        error.code = 'PRACTICE_PUBLISHED_COURSE_LOCKED';
        throw error;
      }
      const tests = input.tests.map((test, index) => ({ ...test, id: `proposed-${index + 1}` })) as RunnerCase[];
      const validation = await runPython({ source: input.referenceSolution, mode: input.executionMode, functionName: input.functionName,
        comparisonMode: input.comparisonMode, ignoreCase: input.ignoreCase, whitespaceMode: input.whitespaceMode,
        suppressInputPrompts: input.suppressInputPrompts, tests });
      if (!validation.passed) {
        const error = new Error('لم يُحفظ التعديل لأن الحل المرجعي لا يجتاز حالات الاختبار الجديدة.') as Error & { code: string };
        error.code = 'PRACTICE_REFERENCE_INVALID';
        throw error;
      }
    }
    await repository.update(request.authUser!, exerciseId, input);
    return { message: existing.status === 'published' ? 'تم التحقق من التعديل ونشر إصدار جديد من التدريب.' : 'تم تحديث التدريب.' };
  });

  app.patch('/:exerciseId/status', {
    preHandler: [...manager, hooks.requireCsrf],
    config: { rateLimit: { max: 12, timeWindow: '1 minute' } },
  }, async (request) => {
    const { exerciseId } = exerciseParams.parse(request.params);
    const { status } = statusSchema.parse(request.body);
    if (status === 'published') {
      const bundle = await repository.executionBundle(request.authUser!, exerciseId);
      const validation = await runPython({ source: bundle.referenceSolution, mode: bundle.executionMode, functionName: bundle.functionName,
        comparisonMode: bundle.comparisonMode, ignoreCase: bundle.ignoreCase, whitespaceMode: bundle.whitespaceMode,
        suppressInputPrompts: bundle.suppressInputPrompts, tests: bundle.tests });
      if (!validation.passed) {
        const error = new Error('الحل المرجعي لا يجتاز جميع حالات الاختبار، لذلك لم يتم نشر التدريب.') as Error & { code: string };
        error.code = 'PRACTICE_REFERENCE_INVALID';
        throw error;
      }
    }
    await repository.setStatus(request.authUser!, exerciseId, status);
    return { message: status === 'published' ? 'تم التحقق من الحل المرجعي ونشر التدريب.' : 'تمت أرشفة التدريب.' };
  });

  app.post('/:exerciseId/run', {
    preHandler: [...student, hooks.requireCsrf],
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async (request) => {
    const { exerciseId } = exerciseParams.parse(request.params);
    const { sourceCode } = sourceSchema.parse(request.body);
    const bundle = await repository.executionBundle(request.authUser!, exerciseId);
    const publicTests = bundle.tests.filter((test) => !test.isHidden);
    const result = await runPython({ source: sourceCode, mode: bundle.executionMode, functionName: bundle.functionName,
      comparisonMode: bundle.comparisonMode, ignoreCase: bundle.ignoreCase, whitespaceMode: bundle.whitespaceMode,
      suppressInputPrompts: bundle.suppressInputPrompts, tests: publicTests });
    return { official: false, result: presentRunnerResult(result, publicTests) };
  });

  app.post('/:exerciseId/submit', {
    preHandler: [...student, hooks.requireCsrf],
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
  }, async (request) => {
    const { exerciseId } = exerciseParams.parse(request.params);
    const { sourceCode } = sourceSchema.parse(request.body);
    const bundle = await repository.executionBundle(request.authUser!, exerciseId);
    const attempt = await repository.startAttempt(request.authUser!, exerciseId, bundle.revision, sourceCode);
    let result: RunnerResult;
    try {
      result = await runPython({ source: sourceCode, mode: bundle.executionMode, functionName: bundle.functionName,
        comparisonMode: bundle.comparisonMode, ignoreCase: bundle.ignoreCase, whitespaceMode: bundle.whitespaceMode,
        suppressInputPrompts: bundle.suppressInputPrompts, tests: bundle.tests });
    } catch (error) {
      if (error instanceof PracticeRunnerError && error.isInfrastructureFailure) {
        await repository.failAttempt(request.authUser!, attempt.id, error.message);
      }
      throw error;
    }
    const saved = await repository.finishAttempt(request.authUser!, attempt.id, exerciseId, result);
    return { official: true, attempt: { ...attempt, ...saved }, result: presentRunnerResult(result, bundle.tests) };
  });
}

async function hydrateExpectedOutputs(input: ExerciseInput): Promise<ExerciseInput> {
  if (!input.autoGenerateExpected) return input;
  const outputs = await generateExpectedPayloads({
    source: input.referenceSolution,
    mode: input.executionMode,
    functionName: input.functionName,
    suppressInputPrompts: input.suppressInputPrompts,
    tests: input.tests.map((test, index) => ({
      id: `generated-${index + 1}`, inputPayload: test.inputPayload, isHidden: test.isHidden, timeLimitMs: test.timeLimitMs,
    })),
  });
  return { ...input, tests: input.tests.map((test, index) => ({ ...test, expectedPayload: outputs[index]! })) };
}

function replyNotFound(): never {
  const error = new Error('التدريب غير موجود.') as Error & { code: string };
  error.code = 'P0002';
  throw error;
}

function presentRunnerResult(result: RunnerResult, tests: RunnerCase[]) {
  const testsById = new Map(tests.map((test) => [test.id, test]));
  return {
    passed: result.passed,
    runtimeMs: result.runtimeMs,
    results: result.results.map((item, index) => {
      const test = testsById.get(item.testCaseId);
      const hidden = Boolean(test?.isHidden);
      return {
        number: index + 1, hidden, passed: item.passed, runtimeMs: item.runtimeMs,
        actualOutput: hidden ? null : item.actualOutput,
        errorMessage: hidden && item.errorMessage ? 'لم تجتز هذه الحالة المخفية.' : item.errorMessage,
      };
    }),
  };
}
