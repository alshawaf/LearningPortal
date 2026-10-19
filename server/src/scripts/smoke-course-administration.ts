import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../app.js';
import { hashPassword } from '../security/password.js';

const databaseUrl = process.env.DATABASE_ADMIN_URL;
const origin = process.env.WEB_ORIGIN;
if (!databaseUrl || !origin) throw new Error('DATABASE_ADMIN_URL and WEB_ORIGIN are required');

const stamp = Date.now();
const suffix = String(stamp).slice(-7);
const password = 'Course-Administration-Smoke-2026!';
const client = new pg.Client({ connectionString: databaseUrl });
const userIds: string[] = [];
let courseId: string | null = null;
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

async function login(identifier: string) {
  const response = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { identifier, password } });
  assert.equal(response.statusCode, 200, response.body);
  const cookies = cookiesFrom(response);
  return { cookies, csrf: cookieValue(cookies, 'mc_csrf') };
}

try {
  await client.connect();
  const passwordHash = await hashPassword(password);
  const levelResult = await client.query<{ id: string }>(
    `select l.id from app.academic_levels l
     join app.specializations s on s.id = l.specialization_id
     join app.academic_departments d on d.id = s.department_id
     where l.is_active and s.is_active and d.is_active order by l.created_at limit 1`,
  );
  const studentLevelId = levelResult.rows[0]?.id;
  assert.ok(studentLevelId, 'Academic hierarchy must include a selectable level');
  const inputs = [
    { email: `course.admin.${stamp}@example.edu`, phone: `+96771${suffix}`, name: 'مدير اختبار المقررات', role: 'admin' },
    { email: `course.teacher.${stamp}@example.edu`, phone: `+96772${suffix}`, name: 'أستاذ اختبار المقررات', role: 'instructor' },
    { email: `course.student.${stamp}@example.edu`, phone: `+96773${suffix}`, name: 'طالب اختبار المقررات', role: 'student' },
  ];
  await client.query('begin');
  for (const input of inputs) {
    const user = await client.query<{ id: string }>(
      'insert into app.users(email, phone_e164, display_name, role, academic_level_id) values ($1::citext, $2, $3, $4, $5) returning id',
      [input.email, input.phone, input.name, input.role, input.role === 'student' ? studentLevelId : null],
    );
    userIds.push(user.rows[0]!.id);
    await client.query('insert into app.password_credentials(user_id, password_hash) values ($1, $2)', [user.rows[0]!.id, passwordHash]);
  }
  await client.query('commit');

  app = await buildApp();
  const [adminId, instructorId, studentId] = userIds;
  const adminSession = await login(inputs[0]!.email);
  const instructorSession = await login(inputs[1]!.email);
  const code = `QA${String(stamp).slice(-6)}`;

  const created = await app.inject({
    method: 'POST', url: '/api/v1/courses',
    headers: { origin, cookie: adminSession.cookies, 'x-csrf-token': adminSession.csrf },
    payload: { code, title: 'مقرر اختبار الدليل' },
  });
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(created.json().course.code, code);
  courseId = created.json().course.id;

  const updatedCode = `${code}U`;
  const updated = await app.inject({
    method: 'PATCH', url: `/api/v1/courses/${courseId}`,
    headers: { origin, cookie: adminSession.cookies, 'x-csrf-token': adminSession.csrf },
    payload: { code: updatedCode, title: 'مقرر اختبار محدّث' },
  });
  assert.equal(updated.statusCode, 200, updated.body);

  const deactivated = await app.inject({
    method: 'PATCH', url: `/api/v1/courses/${courseId}/status`,
    headers: { origin, cookie: adminSession.cookies, 'x-csrf-token': adminSession.csrf },
    payload: { isActive: false },
  });
  assert.equal(deactivated.statusCode, 200, deactivated.body);
  const adminCourses = await app.inject({ method: 'GET', url: '/api/v1/courses/catalog', headers: { cookie: adminSession.cookies } });
  assert.equal(adminCourses.statusCode, 200, adminCourses.body);
  assert.equal(adminCourses.json().courses.find((course: { id: string }) => course.id === courseId).isActive, false);
  const instructorCourses = await app.inject({ method: 'GET', url: '/api/v1/courses', headers: { cookie: instructorSession.cookies } });
  assert.equal(instructorCourses.statusCode, 200, instructorCourses.body);
  assert.equal(instructorCourses.json().courses.some((course: { id: string }) => course.id === courseId), false);

  const reactivated = await app.inject({
    method: 'PATCH', url: `/api/v1/courses/${courseId}/status`,
    headers: { origin, cookie: adminSession.cookies, 'x-csrf-token': adminSession.csrf },
    payload: { isActive: true },
  });
  assert.equal(reactivated.statusCode, 200, reactivated.body);

  const instructorDenied = await app.inject({
    method: 'POST', url: '/api/v1/courses',
    headers: { origin, cookie: instructorSession.cookies, 'x-csrf-token': instructorSession.csrf },
    payload: { code: `${code}I`, title: 'محاولة أستاذ' },
  });
  assert.equal(instructorDenied.statusCode, 403, instructorDenied.body);

  const instructorUpdateDenied = await app.inject({
    method: 'PATCH', url: `/api/v1/courses/${courseId}`,
    headers: { origin, cookie: instructorSession.cookies, 'x-csrf-token': instructorSession.csrf },
    payload: { code: `${code}X`, title: 'محاولة تعديل أستاذ' },
  });
  assert.equal(instructorUpdateDenied.statusCode, 403, instructorUpdateDenied.body);

  const operationalFieldsRejected = await app.inject({
    method: 'POST', url: '/api/v1/courses',
    headers: { origin, cookie: adminSession.cookies, 'x-csrf-token': adminSession.csrf },
    payload: { code: `${code}S`, title: 'محاولة ربط مباشر', ownerUserId: instructorId, levelId: studentLevelId },
  });
  assert.equal(operationalFieldsRejected.statusCode, 400, operationalFieldsRejected.body);

  const persisted = await client.query('select code, title, is_active from app.courses where id = $1', [courseId]);
  assert.equal(persisted.rows[0].code, updatedCode);
  assert.equal(persisted.rows[0].title, 'مقرر اختبار محدّث');
  assert.equal(persisted.rows[0].is_active, true);
  assert.ok(adminId);
  console.log('Independent admin-only course catalog create, update, status, and strict payload smoke test passed.');
} finally {
  if (app) await app.close();
  if (courseId) {
    await client.query('delete from app.course_offerings where course_id=$1', [courseId]).catch(() => undefined);
    await client.query('delete from app.courses where id=$1', [courseId]).catch(() => undefined);
  }
  if (userIds.length) {
    await client.query('delete from app.audit_logs where actor_user_id = any($1::uuid[])', [userIds]).catch(() => undefined);
    await client.query('delete from app.users where id = any($1::uuid[])', [userIds]).catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}
