import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { PracticeRunnerError, type ComparisonMode, type OutputWhitespaceMode, type RunnerCase, type RunnerResult } from './practice-runner-contracts.js';
export { PracticeRunnerError, type ComparisonMode, type OutputWhitespaceMode, type RunnerCase, type RunnerResult } from './practice-runner-contracts.js';

const HARNESS = String.raw`
import decimal, json, os, re, runpy, subprocess, sys, time, unicodedata

payload = json.load(sys.stdin)
mode = payload['mode']
source = payload['source']
function_name = payload.get('functionName')
results = []

source_path = '/tmp/student_solution.py'
with open(source_path, 'w', encoding='utf-8') as source_file:
    source_file.write(source)

stdin_runner = r'''
import builtins, runpy
original_input = builtins.input
def silent_input(prompt=''):
    return original_input()
builtins.input = silent_input
runpy.run_path('/tmp/student_solution.py', run_name='__main__')
'''

def normalize_newlines(value):
    return str(value).replace('\r\n', '\n').replace('\r', '\n')

number_pattern = re.compile(r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?')

def numeric_value(value, allow_labels=False):
    normalized = unicodedata.normalize('NFKC', normalize_newlines(value)).strip()
    numeric_remainder = number_pattern.sub('', normalized)
    if normalized and (allow_labels or not any(character.isalpha() for character in numeric_remainder)) and all(
        allow_labels or character.isspace() or character in '[](){}<>,;:|/' for character in numeric_remainder
    ):
        numbers = tuple(decimal.Decimal(item) for item in number_pattern.findall(normalized))
        if numbers:
            return numbers
    return None

def semantic_value(value):
    normalized = unicodedata.normalize('NFKC', normalize_newlines(value)).strip()
    numbers = numeric_value(normalized)
    if numbers:
        return ('numbers', numbers)
    compact = ''.join(character for character in normalized.casefold() if character.isalnum())
    aliases = {
        'even': 'even', 'evennumber': 'even', 'numberiseven': 'even', 'زوجي': 'even', 'عددزوجي': 'even',
        'odd': 'odd', 'oddnumber': 'odd', 'numberisodd': 'odd', 'فردي': 'odd', 'عددفردي': 'odd',
        'true': 'true', 'yes': 'true', 'correct': 'true', 'صحيح': 'true', 'نعم': 'true',
        'false': 'false', 'no': 'false', 'incorrect': 'false', 'خطأ': 'false', 'لا': 'false',
    }
    return ('text', aliases.get(compact, compact))

def outputs_equal(actual, expected, comparison_mode, ignore_case, whitespace_mode):
    if comparison_mode == 'auto':
        expected_value = semantic_value(expected)
        if expected_value[0] == 'numbers':
            actual_numbers = numeric_value(actual, allow_labels=True)
            return actual_numbers == expected_value[1]
        return semantic_value(actual) == expected_value
    return comparable(actual, comparison_mode, ignore_case, whitespace_mode) == comparable(
        expected, comparison_mode, ignore_case, whitespace_mode
    )

def comparable(value, comparison_mode, ignore_case, whitespace_mode):
    normalized = normalize_newlines(value)
    if comparison_mode == 'exact':
        return normalized.rstrip()
    if whitespace_mode == 'normalize':
        normalized = ' '.join(normalized.split())
    elif whitespace_mode == 'remove':
        normalized = ''.join(normalized.split())
    else:
        normalized = normalized.rstrip()
    if ignore_case:
        normalized = normalized.casefold()
    return normalized

function_runner = r'''
import json, sys
payload = json.load(sys.stdin)
namespace = {'__name__': '__student_solution__'}
exec(compile(payload['source'], '<student-solution>', 'exec'), namespace, namespace)
target = namespace.get(payload['functionName'])
if not callable(target):
    raise NameError('الدالة المطلوبة غير موجودة')
value = target(*payload['arguments'])
print(json.dumps(value, ensure_ascii=False, separators=(',', ':')))
'''

for case in payload['tests']:
    started = time.monotonic()
    passed = False
    actual = None
    error = None
    try:
        timeout = max(0.1, min(10.0, case['timeLimitMs'] / 1000.0))
        if mode == 'stdin':
            command = [sys.executable, '-I', '-B', '-c', stdin_runner] if payload.get('suppressInputPrompts', True) else [sys.executable, '-I', '-B', '-c', source]
            completed = subprocess.run(
                command,
                input=case['input'].get('stdin', ''), text=True,
                capture_output=True, timeout=timeout, env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'PYTHONIOENCODING': 'utf-8'}
            )
            if completed.returncode != 0:
                error = completed.stderr[-700:] or 'تعذر تنفيذ الحل.'
            else:
                actual = completed.stdout.rstrip()
                passed = outputs_equal(
                    actual,
                    case['expected'].get('stdout', ''),
                    payload.get('comparisonMode', 'exact'),
                    payload.get('ignoreCase', False),
                    payload.get('whitespaceMode', 'exact'),
                )
        else:
            completed = subprocess.run(
                [sys.executable, '-I', '-B', '-c', function_runner],
                input=json.dumps({'source': source, 'functionName': function_name, 'arguments': case['input'].get('arguments', [])}, ensure_ascii=False),
                text=True, capture_output=True, timeout=timeout,
                env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'PYTHONIOENCODING': 'utf-8'}
            )
            if completed.returncode != 0:
                error = completed.stderr[-700:] or 'تعذر تنفيذ الحل.'
            else:
                actual = completed.stdout.strip()
                try:
                    passed = json.loads(actual) == case['expected'].get('return')
                except Exception:
                    passed = False
    except subprocess.TimeoutExpired:
        error = 'تجاوز الحل حد الوقت المسموح.'
    except Exception as exc:
        error = str(exc)[:700]
    elapsed = int((time.monotonic() - started) * 1000)
    results.append({'testCaseId': case['id'], 'passed': passed, 'runtimeMs': elapsed, 'actualOutput': actual, 'errorMessage': error})

print(json.dumps({'passed': all(item['passed'] for item in results), 'runtimeMs': sum(item['runtimeMs'] for item in results), 'results': results}, ensure_ascii=False))
`;

function sanitizeMessage(value: unknown): string | null {
  if (!value) return null;
  return String(value)
    .replaceAll(/File "[^"]+"/g, 'File "<student-solution>"')
    .replaceAll(/[\r\n]{3,}/g, '\n\n')
    .slice(-1000);
}

export async function runPython(input: {
  source: string;
  mode: 'stdin' | 'function';
  functionName: string | null;
  comparisonMode?: ComparisonMode;
  ignoreCase?: boolean;
  whitespaceMode?: OutputWhitespaceMode;
  suppressInputPrompts?: boolean;
  tests: RunnerCase[];
}): Promise<RunnerResult> {
  if (!input.tests.length) throw new PracticeRunnerError('لا توجد حالات اختبار قابلة للتنفيذ.', false);
  const containerName = `masar-practice-${randomUUID()}`;
  const args = [
    'run', '--rm', '--name', containerName, '--network', 'none', '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64',
    '--memory', '256m', '--memory-swap', '256m', '--cpus', '0.50', '--user', '65534:65534',
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=16m', '-i', config.practiceRunnerImage,
    'python', '-I', '-B', '-c', HARNESS,
  ];
  const payload = JSON.stringify({
    source: input.source, mode: input.mode, functionName: input.functionName,
    comparisonMode: input.comparisonMode ?? 'exact', ignoreCase: input.ignoreCase ?? false,
    whitespaceMode: input.whitespaceMode ?? 'exact', suppressInputPrompts: input.suppressInputPrompts ?? true,
    tests: input.tests.map((test) => ({ id: test.id, input: test.inputPayload, expected: test.expectedPayload, timeLimitMs: test.timeLimitMs })),
  });

  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: process.env.PATH ?? '' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const cleanup = spawn('docker', ['rm', '-f', containerName], { windowsHide: true, stdio: 'ignore', env: { PATH: process.env.PATH ?? '' } });
      cleanup.unref();
      reject(new PracticeRunnerError('انتهت مهلة خدمة تنفيذ Python.'));
    }, config.practiceRunnerTimeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); if (stdout.length > 1_000_000) child.kill('SIGKILL'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); if (stderr.length > 100_000) child.kill('SIGKILL'); });
    child.once('error', (error) => { clearTimeout(timer); reject(new PracticeRunnerError(`تعذر تشغيل حاوية Python: ${error.message}`)); });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new PracticeRunnerError(sanitizeMessage(stderr) || 'فشل تشغيل حاوية Python.'));
      try {
        const parsed = JSON.parse(stdout.trim()) as RunnerResult;
        resolve({ ...parsed, results: parsed.results.map((result) => ({ ...result, errorMessage: sanitizeMessage(result.errorMessage) })) });
      } catch {
        reject(new PracticeRunnerError('أعادت خدمة Python نتيجة غير صالحة.'));
      }
    });
    child.stdin.end(payload);
  });
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
