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
const password = 'Enrollment-Privacy-Smoke-2026!';
const client = new pg.Client({ connectionString: databaseUrl });
const userIds: string[] = [];
let courseId: string | null = null;
let offeringId: string | null = null;
let sectionId: string | null = null;
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
  const levels = await client.query<{ id: string }>(
    `select l.id from app.academic_levels l
     join app.specializations s on s.id = l.specialization_id
     join app.academic_departments d on d.id = s.department_id
     where l.is_active and s.is_active and d.is_active order by l.created_at, l.id limit 2`,
  );
  assert.equal(levels.rows.length, 2, 'Two active academic levels are required');
  const [matchingLevel, otherLevel] = levels.rows;
  const passwordHash = await hashPassword(password);
  const inputs = [
    { email: `enroll.admin.${stamp}@example.edu`, phone: `+96771${suffix}`, name: 'مدير اختبار التسجيل', role: 'admin', level: null },
    { email: `enroll.owner.${stamp}@example.edu`, phone: `+96772${suffix}`, name: 'أستاذ المقرر', role: 'instructor', level: null },
    { email: `enroll.outsider.${stamp}@example.edu`, phone: `+96773${suffix}`, name: 'أستاذ خارج المقرر', role: 'instructor', level: null },
    { email: `enroll.match.${stamp}@example.edu`, phone: `+96774${suffix}`, name: 'طالب مطابق', role: 'student', level: matchingLevel!.id },
    { email: `enroll.exception.${stamp}@example.edu`, phone: `+96775${suffix}`, name: 'طالب استثناء', role: 'student', level: otherLevel!.id },
  ];
  await client.query('begin');
  for (const input of inputs) {
    const created = await client.query<{ id: string }>(
      'insert into app.users(email, phone_e164, display_name, role, academic_level_id) values ($1::citext, $2, $3, $4, $5) returning id',
      [input.email, input.phone, input.name, input.role, input.level],
    );
    userIds.push(created.rows[0]!.id);
    await client.query('insert into app.password_credentials(user_id, password_hash) values ($1, $2)', [created.rows[0]!.id, passwordHash]);
  }
  await client.query('commit');

  app = await buildApp();
  const [adminId, ownerId, outsiderId, matchingStudentId, exceptionStudentId] = userIds;
  const sessions = await Promise.all(inputs.map((input) => login(input.email)));
  const admin = sessions[0]!;
  const owner = sessions[1]!;
  const outsider = sessions[2]!;
  const matchingStudent = sessions[3]!;
  const exceptionStudent = sessions[4]!;
  const code = `ENR${String(stamp).slice(-6)}`;

  const created = await app.inject({
    method: 'POST', url: '/api/v1/courses',
    headers: { origin, cookie: admin.cookies, 'x-csrf-token': admin.csrf },
    payload: { code, title: 'مقرر اختبار عضوية الشعبة' },
  });
  assert.equal(created.statusCode, 201, created.body);
  courseId = created.json().course.id;
  const delivery=await app.inject({method:'GET',url:'/api/v1/course-offerings',headers:{cookie:admin.cookies}});
  const section=delivery.json().sections.find((item:{levelId:string;status:string})=>item.levelId===matchingLevel!.id&&item.status==='active');
  assert.ok(section,'An active section is required');sectionId=section.id;
  const term=delivery.json().terms.find((item:{academicYearId:string})=>item.academicYearId===section.academicYearId);assert.ok(term);
  const addMatching=await app.inject({method:'POST',url:`/api/v1/course-offerings/sections/${sectionId}/students`,headers:{origin,cookie:admin.cookies,'x-csrf-token':admin.csrf},payload:{studentId:matchingStudentId}});assert.equal(addMatching.statusCode,201,addMatching.body);
  const offering=await app.inject({method:'POST',url:'/api/v1/course-offerings',headers:{origin,cookie:admin.cookies,'x-csrf-token':admin.csrf},payload:{courseId,termId:term.id,sectionId,instructorUserId:ownerId,status:'active'}});assert.equal(offering.statusCode,201,offering.body);offeringId=offering.json().id;

  const adminRoster = await app.inject({ method: 'GET', url: `/api/v1/course-offerings/${offeringId}/enrollments`, headers: { cookie: admin.cookies } });
  assert.equal(adminRoster.statusCode, 200, adminRoster.body);
  assert.equal(adminRoster.json().enrollments.find((entry: { studentId: string }) => entry.studentId === matchingStudentId).enrollmentType, 'section');
  assert.deepEqual(adminRoster.json().candidates, []);

  const ownerRoster = await app.inject({ method: 'GET', url: `/api/v1/course-offerings/${offeringId}/enrollments`, headers: { cookie: owner.cookies } });
  assert.equal(ownerRoster.statusCode, 200, ownerRoster.body);
  assert.equal(ownerRoster.json().enrollments[0].email, null);
  assert.deepEqual(ownerRoster.json().candidates, []);

  const outsiderDenied = await app.inject({ method: 'GET', url: `/api/v1/course-offerings/${offeringId}/enrollments`, headers: { cookie: outsider.cookies } });
  assert.equal(outsiderDenied.statusCode, 403, outsiderDenied.body);
  const instructorWriteDenied = await app.inject({
    method: 'POST', url: `/api/v1/course-offerings/sections/${sectionId}/students`,
    headers: { origin, cookie: owner.cookies, 'x-csrf-token': owner.csrf }, payload: { studentId: exceptionStudentId },
  });
  assert.equal(instructorWriteDenied.statusCode, 403, instructorWriteDenied.body);

  const beforeManual = await app.inject({ method: 'GET', url: '/api/v1/courses', headers: { cookie: exceptionStudent.cookies } });
  assert.equal(beforeManual.json().courses.some((course: { id: string }) => course.id === courseId), false);
  const manuallyAdded = await app.inject({
    method: 'POST', url: `/api/v1/course-offerings/sections/${sectionId}/students`,
    headers: { origin, cookie: admin.cookies, 'x-csrf-token': admin.csrf }, payload: { studentId: exceptionStudentId },
  });
  assert.equal(manuallyAdded.statusCode, 201, manuallyAdded.body);
  const afterManual = await app.inject({ method: 'GET', url: '/api/v1/courses', headers: { cookie: exceptionStudent.cookies } });
  assert.equal(afterManual.json().courses.some((course: { id: string }) => course.id === courseId), true);

  const suspended = await app.inject({
    method: 'PATCH', url: `/api/v1/course-offerings/sections/${sectionId}/students/${exceptionStudentId}`,
    headers: { origin, cookie: admin.cookies, 'x-csrf-token': admin.csrf },
    payload: { status: 'suspended', reason: 'اختبار عزل صلاحية الوصول' },
  });
  assert.equal(suspended.statusCode, 200, suspended.body);
  const afterSuspension = await app.inject({ method: 'GET', url: '/api/v1/courses', headers: { cookie: exceptionStudent.cookies } });
  assert.equal(afterSuspension.json().courses.some((course: { id: string }) => course.id === courseId), false);

  const suspendedRow = await client.query('select status from app.section_memberships where section_id=$1 and student_user_id=$2', [sectionId, exceptionStudentId]);
  assert.equal(suspendedRow.rows[0].status, 'suspended');

  const audit = await client.query(
    `select action from app.audit_logs where target_id=$1
     and action in ('section.membership.add','section.membership.update')`, [sectionId],
  );
  assert.equal(new Set(audit.rows.map((row) => row.action)).size, 2);
  assert.ok(adminId && outsiderId && matchingStudent.cookies);
  console.log('Section membership, inherited course access, status isolation, audit, and roster privacy smoke test passed.');
} finally {
  if (app) await app.close();
  if (courseId) {
    await client.query('delete from app.course_offerings where course_id=$1', [courseId]).catch(() => undefined);
    await client.query('delete from app.courses where id=$1', [courseId]).catch(() => undefined);
  }
  if (userIds.length) {
    await client.query('delete from app.audit_logs where actor_user_id = any($1::uuid[]) or target_id = any($1::uuid[])', [userIds]).catch(() => undefined);
    await client.query('delete from app.users where id = any($1::uuid[])', [userIds]).catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}
