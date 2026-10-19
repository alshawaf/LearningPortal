import 'dotenv/config';
import pg from 'pg';
import { hashPassword, validatePassword } from '../security/password.js';
import { normalizePhone } from '../security/identity.js';

const databaseUrl = process.env.DATABASE_ADMIN_URL;
const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
const displayName = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const rawPhone = process.env.BOOTSTRAP_ADMIN_PHONE?.trim();
const phone = rawPhone ? normalizePhone(rawPhone) : null;
if (!databaseUrl || !email || !displayName || !password) throw new Error('Bootstrap administrator environment values are required');
if (rawPhone && !phone) throw new Error('BOOTSTRAP_ADMIN_PHONE must be a valid international or Yemeni phone number');
const passwordErrors = validatePassword(password);
if (passwordErrors.length) throw new Error(`Bootstrap password rejected: ${passwordErrors.join(' ')}`);

const client = new pg.Client({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false });
await client.connect();
try {
  await client.query('begin');
  const existing = await client.query('select id from app.users where email = $1::citext', [email]);
  if (existing.rowCount) {
    console.log('Bootstrap administrator already exists; no credentials were changed.');
    await client.query('rollback');
  } else {
    const passwordHash = await hashPassword(password);
    const user = await client.query<{ id: string }>(
      `insert into app.users(email, phone_e164, display_name, role, status)
       values ($1::citext, $2, $3, 'admin', 'active') returning id`,
      [email, phone, displayName],
    );
    await client.query(
      'insert into app.password_credentials(user_id, password_hash, must_change_password) values ($1, $2, false)',
      [user.rows[0]!.id, passwordHash],
    );
    await client.query('commit');
    console.log('Bootstrap administrator created successfully.');
  }
} catch (error) {
  await client.query('rollback');
  throw error;
} finally {
  await client.end();
}
