import 'dotenv/config';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { databaseSslFromEnv } from '../db/ssl.js';

const adminUrl = process.env.DATABASE_ADMIN_URL;
const appDbUser = process.env.APP_DB_USER;
if (!adminUrl) throw new Error('DATABASE_ADMIN_URL is required');
if (!appDbUser || !/^[a-z_][a-z0-9_]*$/.test(appDbUser)) throw new Error('APP_DB_USER must be a safe lowercase PostgreSQL identifier');

const client = new pg.Client({ connectionString: adminUrl, ssl: databaseSslFromEnv() });
await client.connect();

try {
  await client.query('select pg_advisory_lock(2026101301)');
  await client.query('create schema if not exists app');
  await client.query(`create table if not exists app.schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`);
  const migrationDir = path.resolve('server/db/migrations');
  const files = (await readdir(migrationDir)).filter((name) => name.endsWith('.sql')).sort();
  for (const file of files) {
    const exists = await client.query('select 1 from app.schema_migrations where name = $1', [file]);
    if (exists.rowCount) continue;
    const sql = await readFile(path.join(migrationDir, file), 'utf8');
    await client.query(sql);
    await client.query('insert into app.schema_migrations(name) values ($1)', [file]);
    console.log(`Applied ${file}`);
  }
  await client.query(`grant masar_api_access to "${appDbUser}"`);
} finally {
  await client.query('select pg_advisory_unlock(2026101301)').catch(() => undefined);
  await client.end();
}
