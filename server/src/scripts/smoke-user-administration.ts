import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../app.js';
import { hashPassword } from '../security/password.js';

const databaseUrl = process.env.DATABASE_ADMIN_URL;
const origin = process.env.WEB_ORIGIN;
if (!databaseUrl || !origin) throw new Error('DATABASE_ADMIN_URL and WEB_ORIGIN are required');

const suffix = String(Date.now()).slice(-8);
const adminEmail = `admin.management.${Date.now()}@example.edu`;
const studentEmail = `student.management.${Date.now()}@example.edu`;
const updatedEmail = `student.updated.${Date.now()}@example.edu`;
const createdStudentEmail = `student.created.${Date.now()}@example.edu`;
const adminPassword = 'Admin-Management-Smoke-2026!';
const studentPassword = 'Student-Management-Smoke-2026!';
const resetPassword = 'Temporary-Reset-2026!';
const client = new pg.Client({ connectionString: databaseUrl });
const userIds: string[] = [];
let app: Awaited<ReturnType<typeof buildApp>> | null = null;

function cookiesFrom(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const values = response.headers['set-cookie'];
  const list = Array.isArray(values) ? values : typeof values === 'string' ? [values] : [];
  return list.map((value) => value.split(';', 1)[0]).join('; ');
}

function cookieValue(cookieHeader: string, name: string) {
  const entry = cookieHeader.split('; ').find((item) => item.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

try {
  await client.connect();
  const [adminHash, studentHash] = await Promise.all([hashPassword(adminPassword), hashPassword(studentPassword)]);
  const levelResult = await client.query<{ id: string }>(
    `select l.id from app.academic_levels l
     join app.specializations s on s.id = l.specialization_id
     join app.academic_departments d on d.id = s.department_id
     where l.is_active and s.is_active and d.is_active order by l.created_at limit 1`,
  );
  const academicLevelId = levelResult.rows[0]?.id;
  assert.ok(academicLevelId, 'Academic hierarchy must include a selectable level');
  await client.query('begin');
  for (const input of [
    { email: adminEmail, phone: `+96771${suffix.slice(-7)}`, name: 'مدير اختبار الإدارة', role: 'admin', hash: adminHash },
    { email: studentEmail, phone: `+96772${suffix.slice(-7)}`, name: 'طالب اختبار الإدارة', role: 'student', hash: studentHash },
  ]) {
    const user = await client.query<{ id: string }>(
      'insert into app.users(email, phone_e164, display_name, role, academic_level_id) values ($1::citext, $2, $3, $4, $5) returning id',
      [input.email, input.phone, input.name, input.role, input.role === 'student' ? academicLevelId : null],
    );
    userIds.push(user.rows[0]!.id);
    await client.query('insert into app.password_credentials(user_id, password_hash) values ($1, $2)', [user.rows[0]!.id, input.hash]);
  }
  await client.query('commit');

  const [adminId, studentId] = userIds;
  app = await buildApp();
  const login = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { identifier: adminEmail, password: adminPassword } });
  assert.equal(login.statusCode, 200, login.body);
  const cookies = cookiesFrom(login);
  const csrf = cookieValue(cookies, 'mc_csrf');

  const studentLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { identifier: studentEmail, password: studentPassword },
  });
  assert.equal(studentLogin.statusCode, 200, studentLogin.body);
  const studentCookies = cookiesFrom(studentLogin);
  const studentCsrf = cookieValue(studentCookies, 'mc_csrf');

  const forbiddenReset = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/users/${adminId}/password`,
    headers: { origin, cookie: studentCookies, 'x-csrf-token': studentCsrf },
    payload: { temporaryPassword: resetPassword, confirmPassword: resetPassword },
  });
  assert.equal(forbiddenReset.statusCode, 403, forbiddenReset.body);

  const mismatchedReset = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/users/${studentId}/password`,
    headers: { origin, cookie: cookies, 'x-csrf-token': csrf },
    payload: { temporaryPassword: resetPassword, confirmPassword: `${resetPassword}x` },
  });
  assert.equal(mismatchedReset.statusCode, 400, mismatchedReset.body);

  const passwordReset = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/users/${studentId}/password`,
    headers: { origin, cookie: cookies, 'x-csrf-token': csrf },
    payload: { temporaryPassword: resetPassword, confirmPassword: resetPassword },
  });
  assert.equal(passwordReset.statusCode, 200, passwordReset.body);

  const revokedStudentSession = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: studentCookies } });
  assert.equal(revokedStudentSession.statusCode, 401, revokedStudentSession.body);
  const oldPasswordLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { identifier: studentEmail, password: studentPassword },
  });
  assert.equal(oldPasswordLogin.statusCode, 401, oldPasswordLogin.body);
  const temporaryPasswordLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { identifier: studentEmail, password: resetPassword },
  });
  assert.equal(temporaryPasswordLogin.statusCode, 200, temporaryPasswordLogin.body);
  assert.equal(temporaryPasswordLogin.json().user.mustChangePassword, true);
  const resetAudit = await client.query(
    `select metadata from app.audit_logs where actor_user_id=$1 and target_id=$2 and action='admin.user.password_reset' order by created_at desc limit 1`,
    [adminId, studentId],
  );
  assert.deepEqual(resetAudit.rows[0]?.metadata, { sessionsRevoked: true, mustChangePassword: true });
  const auditLog = await app.inject({ method: 'GET', url: '/api/v1/admin/audit?action=password_reset&limit=10', headers: { cookie: cookies } });
  assert.equal(auditLog.statusCode, 200, auditLog.body);
  assert.ok(auditLog.json().entries.some((entry: { action: string; targetId: string }) => entry.action === 'admin.user.password_reset' && entry.targetId === studentId));
  const forbiddenAudit = await app.inject({ method: 'GET', url: '/api/v1/admin/audit', headers: { cookie: cookiesFrom(temporaryPasswordLogin) } });
  assert.equal(forbiddenAudit.statusCode, 403, forbiddenAudit.body);

  const missingLevel = await app.inject({
    method: 'POST', url: '/api/v1/admin/users',
    headers: { origin, cookie: cookies, 'x-csrf-token': csrf },
    payload: { email: createdStudentEmail, phone: `+96774${suffix.slice(-7)}`, displayName: 'طالب بلا مستوى', role: 'student', academicLevelId: null, temporaryPassword: studentPassword },
  });
  assert.equal(missingLevel.statusCode, 400, missingLevel.body);

  const createStudent = await app.inject({
    method: 'POST', url: '/api/v1/admin/users',
    headers: { origin, cookie: cookies, 'x-csrf-token': csrf },
    payload: { email: createdStudentEmail, phone: `+96774${suffix.slice(-7)}`, displayName: 'طالب مرتبط بمستوى', role: 'student', academicLevelId, temporaryPassword: studentPassword },
  });
  assert.equal(createStudent.statusCode, 201, createStudent.body);
  userIds.push(createStudent.json().id);
  const createdStudent = await client.query('select role::text, academic_level_id from app.users where id = $1', [createStudent.json().id]);
  assert.deepEqual(createdStudent.rows[0], { role: 'student', academic_level_id: academicLevelId });

  const update = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/users/${studentId}`,
    headers: { origin, cookie: cookies, 'x-csrf-token': csrf },
    payload: { email: updatedEmail, phone: `+96773${suffix.slice(-7)}`, displayName: 'مستخدم محدّث', role: 'instructor', academicLevelId: null },
  });
  assert.equal(update.statusCode, 200, update.body);

  const suspend = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/users/${studentId}/status`,
    headers: { origin, cookie: cookies, 'x-csrf-token': csrf }, payload: { status: 'suspended' },
  });
  assert.equal(suspend.statusCode, 200, suspend.body);

  const deniedLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { identifier: updatedEmail, password: resetPassword },
  });
  assert.equal(deniedLogin.statusCode, 401, deniedLogin.body);

  const selfProtection = await app.inject({
    method: 'PATCH', url: `/api/v1/admin/users/${adminId}/status`,
    headers: { origin, cookie: cookies, 'x-csrf-token': csrf }, payload: { status: 'disabled' },
  });
  assert.equal(selfProtection.statusCode, 409, selfProtection.body);
  assert.equal(selfProtection.json().error.code, 'ACCOUNT_SAFETY_CONFLICT');

  const persisted = await client.query('select email::text, phone_e164, display_name, role::text, status::text, academic_level_id from app.users where id = $1', [studentId]);
  assert.deepEqual(persisted.rows[0], {
    email: updatedEmail, phone_e164: `+96773${suffix.slice(-7)}`,
    display_name: 'مستخدم محدّث', role: 'instructor', status: 'suspended', academic_level_id: null,
  });
  console.log('User administration, password reset, and admin-only audit log integration smoke test passed.');
} finally {
  if (app) await app.close();
  if (userIds.length) {
    await client.query('delete from app.audit_logs where target_id = any($1::uuid[]) or actor_user_id = any($1::uuid[])', [userIds]).catch(() => undefined);
    await client.query('delete from app.users where id = any($1::uuid[])', [userIds]).catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}
