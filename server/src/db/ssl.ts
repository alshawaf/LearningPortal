import type { ConnectionOptions } from 'node:tls';

export type DatabaseSslMode = 'disable' | 'private-network' | 'require' | 'verify-full';

export function databaseSsl(mode: DatabaseSslMode, isProduction: boolean): false | ConnectionOptions {
  if (mode === 'disable') {
    if (isProduction) throw new Error('DATABASE_SSL_MODE=disable is forbidden in production');
    return false;
  }
  if (mode === 'private-network') return false;
  if (mode === 'require') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

export function databaseSslFromEnv(): false | ConnectionOptions {
  const production = process.env.NODE_ENV === 'production';
  const fallback: DatabaseSslMode = production ? 'verify-full' : 'disable';
  const mode = (process.env.DATABASE_SSL_MODE || fallback) as DatabaseSslMode;
  if (!['disable', 'private-network', 'require', 'verify-full'].includes(mode)) {
    throw new Error('Invalid DATABASE_SSL_MODE');
  }
  return databaseSsl(mode, production);
}
