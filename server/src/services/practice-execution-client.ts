import { config } from '../config.js';
import { PracticeRunnerError, type ComparisonMode, type OutputWhitespaceMode, type RunnerCase, type RunnerResult } from './practice-runner-contracts.js';

export type PythonExecutionInput = {
  source: string;
  mode: 'stdin' | 'function';
  functionName: string | null;
  comparisonMode?: ComparisonMode;
  ignoreCase?: boolean;
  whitespaceMode?: OutputWhitespaceMode;
  suppressInputPrompts?: boolean;
  tests: RunnerCase[];
};

export async function runPython(input: PythonExecutionInput): Promise<RunnerResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.practiceRunnerTimeoutMs + 5_000);
  try {
    const response = await fetch(`${config.practiceRunnerUrl}/v1/execute/python`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.practiceRunnerSharedSecret}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null) as { result?: RunnerResult; error?: { message?: string; infrastructure?: boolean } } | null;
    if (!response.ok || !body?.result) {
      throw new PracticeRunnerError(body?.error?.message || 'خدمة تنفيذ Python غير متاحة.', body?.error?.infrastructure !== false);
    }
    return body.result;
  } catch (error) {
    if (error instanceof PracticeRunnerError) throw error;
    const message = error instanceof Error && error.name === 'AbortError'
      ? 'انتهت مهلة الاتصال بخدمة تنفيذ Python.'
      : 'تعذر الاتصال بخدمة تنفيذ Python.';
    throw new PracticeRunnerError(message);
  } finally {
    clearTimeout(timer);
  }
}

export async function runnerHealth(): Promise<{ status: string; active: number; queued: number; capacity: number }> {
  const response = await fetch(`${config.practiceRunnerUrl}/health`, { signal: AbortSignal.timeout(2_500) });
  if (!response.ok) throw new PracticeRunnerError('خدمة تنفيذ Python غير جاهزة.');
  return response.json() as Promise<{ status: string; active: number; queued: number; capacity: number }>;
}

export async function generateExpectedPayloads(input: {
  source: string;
  mode: 'stdin' | 'function';
  functionName: string | null;
  suppressInputPrompts?: boolean;
  tests: Array<Omit<RunnerCase, 'expectedPayload'>>;
}): Promise<Array<RunnerCase['expectedPayload']>> {
  const probeTests: RunnerCase[] = input.tests.map((test) => ({
    ...test,
    expectedPayload: input.mode === 'stdin' ? { stdout: '' } : { return: null },
  }));
  const result = await runPython({
    source: input.source,
    mode: input.mode,
    functionName: input.functionName,
    comparisonMode: 'exact',
    suppressInputPrompts: input.suppressInputPrompts,
    tests: probeTests,
  });
  const failure = result.results.find((item) => item.errorMessage || item.actualOutput === null);
  if (failure) throw new PracticeRunnerError(failure.errorMessage || 'لم ينتج الحل المرجعي قيمة قابلة للتقييم.', false);
  return result.results.map((item) => {
    if (input.mode === 'stdin') return { stdout: item.actualOutput ?? '' };
    try {
      return { return: JSON.parse(item.actualOutput ?? 'null') as unknown };
    } catch {
      throw new PracticeRunnerError('أعاد الحل المرجعي قيمة غير صالحة.', false);
    }
  });
}
