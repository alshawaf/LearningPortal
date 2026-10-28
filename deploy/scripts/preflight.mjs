import { readFile } from 'node:fs/promises';

const path = process.argv[2] || 'deploy/.env.production';
const raw = await readFile(path, 'utf8').catch(() => {
  throw new Error(`Production environment file was not found: ${path}`);
});
const values = Object.fromEntries(raw.split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const position = line.indexOf('=');
    return position > 0 ? [line.slice(0, position), line.slice(position + 1)] : [line, ''];
  }));

const required = ['APP_DOMAIN', 'SUPPORT_EMAIL', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD',
  'APP_DB_USER', 'APP_DB_PASSWORD', 'IP_HASH_SECRET', 'PRACTICE_RUNNER_SHARED_SECRET'];
const errors = [];
for (const key of required) {
  const value = values[key]?.trim() || '';
  if (!value) errors.push(`${key} is required`);
  if (/replace-with|example\.(edu|com)/i.test(value)) errors.push(`${key} still contains an example value`);
}
for (const key of ['POSTGRES_PASSWORD', 'APP_DB_PASSWORD', 'IP_HASH_SECRET', 'PRACTICE_RUNNER_SHARED_SECRET']) {
  if ((values[key] || '').length < 32) errors.push(`${key} must contain at least 32 characters`);
}
if (values.POSTGRES_PASSWORD === values.APP_DB_PASSWORD) errors.push('Database owner and API passwords must differ');
if (values.IP_HASH_SECRET === values.PRACTICE_RUNNER_SHARED_SECRET) errors.push('Application secrets must differ');
if (values.APP_DOMAIN && (!values.APP_DOMAIN.includes('.') || values.APP_DOMAIN.includes('://'))) errors.push('APP_DOMAIN must be a hostname without a protocol');
if (errors.length) {
  console.error(`Production preflight failed:\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log('Production environment preflight passed without displaying secrets.');
