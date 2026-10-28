import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config.js';
import type { AuthUser } from '../domain/auth.js';
import { databaseSsl } from './ssl.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: config.databasePoolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  maxUses: 7_500,
  ssl: databaseSsl(config.databaseSslMode, config.isProduction),
  application_name: 'learning-portal-api',
});

pool.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', { name: error.name, message: error.message });
});

export async function withUserContext<T>(
  user: Pick<AuthUser, 'id' | 'role'>,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(
      `select set_config('app.user_id', $1, true), set_config('app.user_role', $2, true)`,
      [user.id, user.role],
    );
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export function rows<T extends QueryResultRow>(value: T[]): T[] {
  return value;
}
