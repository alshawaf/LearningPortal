export type RunnerCase = {
  id: string;
  inputPayload: { stdin?: string; arguments?: unknown[] };
  expectedPayload: { stdout?: string; return?: unknown };
  isHidden: boolean;
  timeLimitMs: number;
};

export type ComparisonMode = 'auto' | 'exact' | 'flexible';
export type OutputWhitespaceMode = 'exact' | 'normalize' | 'remove';
export type RunnerResult = {
  passed: boolean;
  runtimeMs: number;
  results: Array<{ testCaseId: string; passed: boolean; runtimeMs: number; actualOutput: string | null; errorMessage: string | null }>;
};

export class PracticeRunnerError extends Error {
  constructor(message: string, readonly isInfrastructureFailure = true) {
    super(message);
    this.name = 'PracticeRunnerError';
  }
}
