import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../app.js';
import { hashPassword } from '../security/password.js';

const databaseUrl = process.env.DATABASE_ADMIN_URL;
const origin = process.env.WEB_ORIGIN;
if (!databaseUrl || !origin) throw new Error('DATABASE_ADMIN_URL and WEB_ORIGIN are required');

const suffix = String(Date.now()).slice(-8);
const email = `phone-login.${Date.now()}@example.edu`;
const phone = `+9677${suffix}`;
const localPhone = `0${phone.slice(4)}`;
const password = 'Phone-Login-Smoke-2026-Strong';
const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
});
let userId: string | null = null;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;

try {
  await client.connect();
  const passwordHash = await hashPassword(password);
  const levelResult = await client.query<{ id: string }>(
    `select l.id from app.academic_levels l
     join app.specializations s on s.id = l.specialization_id
     join app.academic_departments d on d.id = s.department_id
     where l.is_active and s.is_active and d.is_active order by l.created_at limit 1`,
  );
  const academicLevelId = levelResult.rows[0]?.id;
  assert.ok(academicLevelId, 'Academic hierarchy must include a selectable level');
  await client.query('begin');
  const user = await client.query<{ id: string }>(
    `insert into app.users(email, phone_e164, display_name, role, academic_level_id)
     values ($1::citext, $2, $3, 'student', $4) returning id`,
    [email, phone, 'اختبار دخول الجوال', academicLevelId],
  );
  userId = user.rows[0]!.id;
  await client.query(
    'insert into app.password_credentials(user_id, password_hash, must_change_password) values ($1, $2, false)',
    [userId, passwordHash],
  );
  await client.query('commit');

  app = await buildApp();
  const emailLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', headers: { origin },
    payload: { identifier: email.toUpperCase(), password },
  });
  assert.equal(emailLogin.statusCode, 200, emailLogin.body);
  assert.equal(emailLogin.json().user.id, userId);
  assert.equal(emailLogin.json().user.phone, phone);

  const phoneLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', headers: { origin },
    payload: { identifier: localPhone, password },
  });
  assert.equal(phoneLogin.statusCode, 200, phoneLogin.body);
  assert.equal(phoneLogin.json().user.id, userId);
  assert.equal(phoneLogin.json().user.email, email);
  console.log('Email and phone login database smoke test passed.');
} finally {
  if (app) await app.close();
  if (userId) {
    await client.query('delete from app.users where id = $1', [userId]).catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}
