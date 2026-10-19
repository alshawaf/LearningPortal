import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUSTED_PROXY: z.string().trim().min(1).optional(),
  WEB_ORIGIN: z.string().url(),
  DATABASE_URL: z.string().min(20),
  DATABASE_POOL_MAX: z.coerce.number().int().min(2).max(50).default(10),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(8),
  IP_HASH_SECRET: z.string().min(32),
  PRACTICE_RUNNER_IMAGE: z.string().min(3).default('python:3.12-alpine'),
  PRACTICE_RUNNER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(20000),
  PRACTICE_RUNNER_URL: z.string().url().default('http://127.0.0.1:4001'),
  PRACTICE_RUNNER_SHARED_SECRET: z.string().min(32).optional(),
  RUNNER_HOST: z.string().default('127.0.0.1'),
  RUNNER_PORT: z.coerce.number().int().min(1).max(65535).default(4001),
  RUNNER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(2),
  RUNNER_MAX_QUEUE: z.coerce.number().int().min(1).max(1000).default(100),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  const keys = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Invalid server configuration: ${keys}`);
}
if (parsed.data.NODE_ENV === 'production' && !parsed.data.PRACTICE_RUNNER_SHARED_SECRET) {
  throw new Error('Invalid server configuration: PRACTICE_RUNNER_SHARED_SECRET');
}

export const config = {
  nodeEnv: parsed.data.NODE_ENV,
  host: parsed.data.API_HOST,
  port: parsed.data.API_PORT,
  trustedProxy: parsed.data.TRUSTED_PROXY ?? false,
  webOrigin: new URL(parsed.data.WEB_ORIGIN).origin,
  databaseUrl: parsed.data.DATABASE_URL,
  databasePoolMax: parsed.data.DATABASE_POOL_MAX,
  sessionTtlHours: parsed.data.SESSION_TTL_HOURS,
  ipHashSecret: parsed.data.IP_HASH_SECRET,
  practiceRunnerImage: parsed.data.PRACTICE_RUNNER_IMAGE,
  practiceRunnerTimeoutMs: parsed.data.PRACTICE_RUNNER_TIMEOUT_MS,
  practiceRunnerUrl: parsed.data.PRACTICE_RUNNER_URL,
  practiceRunnerSharedSecret: parsed.data.PRACTICE_RUNNER_SHARED_SECRET ?? parsed.data.IP_HASH_SECRET,
  runnerHost: parsed.data.RUNNER_HOST,
  runnerPort: parsed.data.RUNNER_PORT,
  runnerMaxConcurrency: parsed.data.RUNNER_MAX_CONCURRENCY,
  runnerMaxQueue: parsed.data.RUNNER_MAX_QUEUE,
  isProduction: parsed.data.NODE_ENV === 'production',
} as const;
