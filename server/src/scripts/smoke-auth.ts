import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../app.js';
import { hashPassword } from '../security/password.js';

const origin = process.env.WEB_ORIGIN!;
const stamp = Date.now();
const adminEmail = `admin.smoke.${stamp}@example.edu`;
const adminPhone = `+9676${String(stamp).slice(-8)}`;
const adminPassword = 'Admin-Smoke-2026-Strong';
const studentEmail = `student.smoke.${stamp}@example.edu`;
const studentPhone = `+9677${String(stamp).slice(-8)}`;
const studentPassword = 'Student-Smoke-2026-Strong';
const studentNewPassword = 'Student-Smoke-Changed-2026';
const databaseUrl = process.env.DATABASE_ADMIN_URL!;
const client = new pg.Client({ connectionString: databaseUrl });
let adminId: string | null = null;
let studentId: string | null = null;
const app = await buildApp();

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
  const adminPasswordHash = await hashPassword(adminPassword);
  const admin = await client.query<{ id: string }>(
    `insert into app.users(email,phone_e164,display_name,role)
     values($1::citext,$2,'مدير اختبار المصادقة','admin') returning id`,
    [adminEmail, adminPhone],
  );
  adminId = admin.rows[0]!.id;
  await client.query(
    'insert into app.password_credentials(user_id,password_hash,must_change_password) values($1,$2,false)',
    [adminId, adminPasswordHash],
  );
  const login = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', headers: { origin },
    payload: { identifier: adminEmail, password: adminPassword },
  });
  assert.equal(login.statusCode, 200, login.body);
  const adminCookies = cookiesFrom(login);
  const csrf = cookieValue(adminCookies, 'mc_csrf');
  assert.ok(adminCookies.includes('mc_session='));
  assert.ok(csrf);

  const session = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: adminCookies } });
  assert.equal(session.statusCode, 200, session.body);
  assert.equal(session.json().user.role, 'admin');
  const structure = await app.inject({ method: 'GET', url: '/api/v1/academic-structure', headers: { cookie: adminCookies } });
  assert.equal(structure.statusCode, 200, structure.body);
  const academicLevelId = structure.json().departments.flatMap((department: { specializations: Array<{ levels: Array<{ id: string }> }> }) => department.specializations.flatMap((specialization) => specialization.levels))[0]?.id;
  assert.ok(academicLevelId, 'Academic hierarchy must include a selectable level');

  const missingCsrf = await app.inject({
    method: 'POST', url: '/api/v1/admin/users', headers: { origin, cookie: adminCookies },
    payload: { email: studentEmail, phone: studentPhone, displayName: 'طالب اختبار', role: 'student', academicLevelId, temporaryPassword: studentPassword },
  });
  assert.equal(missingCsrf.statusCode, 403);

  const missingAcademicLevel = await app.inject({
    method: 'POST', url: '/api/v1/admin/users',
    headers: { origin, cookie: adminCookies, 'x-csrf-token': csrf },
    payload: { email: studentEmail, phone: studentPhone, displayName: 'طالب اختبار', role: 'student', academicLevelId: null, temporaryPassword: studentPassword },
  });
  assert.equal(missingAcademicLevel.statusCode, 400, missingAcademicLevel.body);

  const createStudent = await app.inject({
    method: 'POST', url: '/api/v1/admin/users',
    headers: { origin, cookie: adminCookies, 'x-csrf-token': csrf },
    payload: { email: studentEmail, phone: studentPhone, displayName: 'طالب اختبار', role: 'student', academicLevelId, temporaryPassword: studentPassword },
  });
  assert.equal(createStudent.statusCode, 201, createStudent.body);
  studentId = createStudent.json().id;

  const studentLogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', headers: { origin },
    payload: { identifier: studentPhone, password: studentPassword },
  });
  assert.equal(studentLogin.statusCode, 200, studentLogin.body);
  assert.equal(studentLogin.json().user.mustChangePassword, true);
  const studentCookies = cookiesFrom(studentLogin);
  const studentCsrf = cookieValue(studentCookies, 'mc_csrf');

  const passwordGate = await app.inject({ method: 'GET', url: '/api/v1/courses', headers: { cookie: studentCookies } });
  assert.equal(passwordGate.statusCode, 403, passwordGate.body);
  assert.equal(passwordGate.json().error.code, 'PASSWORD_CHANGE_REQUIRED');

  const changePassword = await app.inject({
    method: 'POST', url: '/api/v1/auth/change-password',
    headers: { origin, cookie: studentCookies, 'x-csrf-token': studentCsrf },
    payload: { currentPassword: studentPassword, newPassword: studentNewPassword },
  });
  assert.equal(changePassword.statusCode, 200, changePassword.body);
  const oldStudentSession = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: studentCookies } });
  assert.equal(oldStudentSession.statusCode, 401, oldStudentSession.body);

  const studentRelogin = await app.inject({
    method: 'POST', url: '/api/v1/auth/login', headers: { origin },
    payload: { identifier: studentEmail, password: studentNewPassword },
  });
  assert.equal(studentRelogin.statusCode, 200, studentRelogin.body);
  const establishedStudentCookies = cookiesFrom(studentRelogin);
  const forbidden = await app.inject({ method: 'GET', url: '/api/v1/admin/users', headers: { cookie: establishedStudentCookies } });
  assert.equal(forbidden.statusCode, 403);

  const logout = await app.inject({
    method: 'POST', url: '/api/v1/auth/logout',
    headers: { origin, cookie: adminCookies, 'x-csrf-token': csrf },
  });
  assert.equal(logout.statusCode, 204, logout.body);
  const revoked = await app.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: adminCookies } });
  assert.equal(revoked.statusCode, 401);
  console.log('Authentication integration smoke test passed.');
} finally {
  await app.close();
  if (studentId) {
    await client.query('delete from app.audit_logs where target_id = $1 or actor_user_id = $1', [studentId]).catch(() => undefined);
    await client.query('delete from app.users where id = $1', [studentId]).catch(() => undefined);
  }
  if (adminId) {
    await client.query('delete from app.audit_logs where target_id = $1 or actor_user_id = $1', [adminId]).catch(() => undefined);
    await client.query('delete from app.users where id = $1', [adminId]).catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}
