import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { runPython, runnerHealth } from '../services/practice-execution-client.js';

const requestCount = Math.min(50, Math.max(1, Number(process.env.RUNNER_LOAD_REQUESTS || 12)));
const maxP95 = Math.max(1_000, Number(process.env.RUNNER_LOAD_MAX_P95_MS || 20_000));
const before = await runnerHealth();
assert.equal(before.status, 'ok');

const durations = await Promise.all(Array.from({ length: requestCount }, async (_, index) => {
  const started = performance.now();
  const result = await runPython({
    source: 'value = int(input())\nprint(value * 2)', mode: 'stdin', functionName: null,
    comparisonMode: 'auto', suppressInputPrompts: true,
    tests: [{ id: `load-${index}`, isHidden: true, timeLimitMs: 2_000, inputPayload: { stdin: `${index}\n` }, expectedPayload: { stdout: String(index * 2) } }],
  });
  assert.equal(result.passed, true);
  return performance.now() - started;
}));
durations.sort((a, b) => a - b);
const percentile = (ratio: number) => durations[Math.min(durations.length - 1, Math.ceil(durations.length * ratio) - 1)]!;
const p95 = percentile(0.95);
assert.ok(p95 <= maxP95, `Runner p95 ${p95.toFixed(0)}ms exceeds ${maxP95}ms`);
console.log(JSON.stringify({ requests: requestCount, capacity: before.capacity, p50Ms: Math.round(percentile(0.5)), p95Ms: Math.round(p95), maxMs: Math.round(durations.at(-1)!) }));
