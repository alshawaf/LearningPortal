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
const password = 'Academic-Structure-Smoke-2026!';
const client = new pg.Client({ connectionString: databaseUrl });
const userIds: string[] = [];
const createdIds: string[] = [];
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
  const inputs = [
    { email: `structure.admin.${stamp}@example.edu`, phone: `+96774${suffix}`, name: 'مدير اختبار الهيكل', role: 'admin' },
    { email: `structure.teacher.${stamp}@example.edu`, phone: `+96775${suffix}`, name: 'أستاذ اختبار الهيكل', role: 'instructor' },
  ];
  for (const input of inputs) {
    const user = await client.query<{ id: string }>(
      'insert into app.users(email, phone_e164, display_name, role) values ($1::citext, $2, $3, $4) returning id',
      [input.email, input.phone, input.name, input.role],
    );
    userIds.push(user.rows[0]!.id);
    await client.query('insert into app.password_credentials(user_id, password_hash) values ($1, $2)', [user.rows[0]!.id, passwordHash]);
  }

  app = await buildApp();
  const adminSession = await login(inputs[0]!.email);
  const instructorSession = await login(inputs[1]!.email);
  const headers = { origin, cookie: adminSession.cookies, 'x-csrf-token': adminSession.csrf };
  const codeSuffix = String(stamp).slice(-6);

  const departmentResponse = await app.inject({ method: 'POST', url: '/api/v1/academic-structure/departments', headers, payload: { code: `D${codeSuffix}`, name: 'دائرة اختبار الهيكل' } });
  assert.equal(departmentResponse.statusCode, 201, departmentResponse.body);
  const departmentId = departmentResponse.json().department.id;
  createdIds.push(departmentId);

  const specializationResponse = await app.inject({ method: 'POST', url: `/api/v1/academic-structure/departments/${departmentId}/specializations`, headers, payload: { code: `S${codeSuffix}`, name: 'تخصص اختبار الهيكل' } });
  assert.equal(specializationResponse.statusCode, 201, specializationResponse.body);
  const specializationId = specializationResponse.json().specialization.id;
  createdIds.push(specializationId);

  const levelResponse = await app.inject({ method: 'POST', url: `/api/v1/academic-structure/specializations/${specializationId}/levels`, headers, payload: { number: 3, name: 'المستوى الثالث' } });
  assert.equal(levelResponse.statusCode, 201, levelResponse.body);
  const levelId = levelResponse.json().level.id;
  createdIds.push(levelId);

  const updatedDepartmentCode = `U${codeSuffix}`;
  const updatedSpecializationCode = `V${codeSuffix}`;
  const departmentUpdate = await app.inject({ method: 'PATCH', url: `/api/v1/academic-structure/departments/${departmentId}`, headers, payload: { code: updatedDepartmentCode, name: 'الدائرة المحدثة' } });
  assert.equal(departmentUpdate.statusCode, 200, departmentUpdate.body);
  const specializationUpdate = await app.inject({ method: 'PATCH', url: `/api/v1/academic-structure/specializations/${specializationId}`, headers, payload: { code: updatedSpecializationCode, name: 'التخصص المحث' } });
  assert.equal(specializationUpdate.statusCode, 200, specializationUpdate.body);
  const levelUpdate = await app.inject({ method: 'PATCH', url: `/api/v1/academic-structure/levels/${levelId}`, headers, payload: { number: 4, name: 'المستوى الرابع' } });
  assert.equal(levelUpdate.statusCode, 200, levelUpdate.body);

  const listResponse = await app.inject({ method: 'GET', url: '/api/v1/academic-structure', headers: { cookie: adminSession.cookies } });
  assert.equal(listResponse.statusCode, 200, listResponse.body);
  const department = listResponse.json().departments.find((item: { id: string }) => item.id === departmentId);
  assert.equal(department.code, updatedDepartmentCode);
  assert.equal(department.name, 'الدائرة المحدثة');
  assert.equal(department.specializations[0].id, specializationId);
  assert.equal(department.specializations[0].code, updatedSpecializationCode);
  assert.equal(department.specializations[0].name, 'التخصص المحث');
  assert.equal(department.specializations[0].levels[0].id, levelId);
  assert.equal(department.specializations[0].levels[0].number, 4);
  assert.equal(department.specializations[0].levels[0].name, 'المستوى الرابع');

  const denied = await app.inject({
    method: 'POST', url: '/api/v1/academic-structure/departments',
    headers: { origin, cookie: instructorSession.cookies, 'x-csrf-token': instructorSession.csrf },
    payload: { code: `X${codeSuffix}`, name: 'محاولة غير مصرحة' },
  });
  assert.equal(denied.statusCode, 403, denied.body);

  const deniedUpdate = await app.inject({
    method: 'PATCH', url: `/api/v1/academic-structure/departments/${departmentId}`,
    headers: { origin, cookie: instructorSession.cookies, 'x-csrf-token': instructorSession.csrf },
    payload: { code: `Z${codeSuffix}`, name: 'محاولة تعديل غير مصرحة' },
  });
  assert.equal(deniedUpdate.statusCode, 403, deniedUpdate.body);

  const duplicate = await app.inject({ method: 'POST', url: '/api/v1/academic-structure/departments', headers, payload: { code: updatedDepartmentCode, name: 'دائرة مكررة' } });
  if (duplicate.statusCode === 201) createdIds.push(duplicate.json().department.id);
  assert.equal(duplicate.statusCode, 409, duplicate.body);
  console.log('Academic structure create and update integration smoke test passed.');
} finally {
  if (app) await app.close();
  if (createdIds.length) await client.query('delete from app.audit_logs where target_id = any($1::uuid[])', [createdIds]).catch(() => undefined);
  if (createdIds[2]) await client.query('delete from app.academic_levels where id = $1', [createdIds[2]]).catch(() => undefined);
  if (createdIds[1]) await client.query('delete from app.specializations where id = $1', [createdIds[1]]).catch(() => undefined);
  if (createdIds[0]) await client.query('delete from app.academic_departments where id = $1', [createdIds[0]]).catch(() => undefined);
  if (userIds.length) {
    await client.query('delete from app.audit_logs where actor_user_id = any($1::uuid[])', [userIds]).catch(() => undefined);
    await client.query('delete from app.users where id = any($1::uuid[])', [userIds]).catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}
