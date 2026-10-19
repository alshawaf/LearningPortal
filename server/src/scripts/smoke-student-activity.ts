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
const password = 'Activity-Privacy-Smoke-2026!';
const client = new pg.Client({ connectionString: databaseUrl });
const userIds: string[] = [];
let courseId: string | null = null;
let offeringId: string | null = null;
let exerciseId: string | null = null;
let activityId: string | null = null;
let app: Awaited<ReturnType<typeof buildApp>> | null = null;

function cookiesFrom(response: { headers: Record<string, string | string[] | number | undefined> }) {
  const values = response.headers['set-cookie'];
  const list = Array.isArray(values) ? values : typeof values === 'string' ? [values] : [];
  return list.map((value) => value.split(';', 1)[0]).join('; ');
}

async function login(identifier: string) {
  const response = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { origin }, payload: { identifier, password } });
  assert.equal(response.statusCode, 200, response.body);
  return { cookies: cookiesFrom(response) };
}

try {
  await client.connect();
  const level = await client.query<{ id: string }>(
    `select l.id from app.academic_levels l
     join app.specializations s on s.id=l.specialization_id
     join app.academic_departments d on d.id=s.department_id
     where l.is_active and s.is_active and d.is_active order by l.created_at limit 1`,
  );
  assert.ok(level.rows[0], 'An active academic level is required');
  const passwordHash = await hashPassword(password);
  const inputs = [
    { email: `activity.admin.${stamp}@example.edu`, phone: `+96771${suffix}`, name: 'مدير اختبار النشاط', role: 'admin', level: null },
    { email: `activity.owner.${stamp}@example.edu`, phone: `+96772${suffix}`, name: 'أستاذ اختبار النشاط', role: 'instructor', level: null },
    { email: `activity.outsider.${stamp}@example.edu`, phone: `+96773${suffix}`, name: 'أستاذ خارج النشاط', role: 'instructor', level: null },
    { email: `activity.student.${stamp}@example.edu`, phone: `+96774${suffix}`, name: 'طالب اختبار النشاط', role: 'student', level: level.rows[0]!.id },
  ];
  await client.query('begin');
  for (const input of inputs) {
    const created = await client.query<{ id: string }>(
      'insert into app.users(email,phone_e164,display_name,role,academic_level_id) values($1::citext,$2,$3,$4,$5) returning id',
      [input.email, input.phone, input.name, input.role, input.level],
    );
    userIds.push(created.rows[0]!.id);
    await client.query('insert into app.password_credentials(user_id,password_hash,must_change_password) values($1,$2,false)', [created.rows[0]!.id, passwordHash]);
  }
  const [, ownerId, , studentId] = userIds;
  const course = await client.query<{ id: string }>(
    `insert into app.courses(code,title) values($1,$2) returning id`,
    [`ACT${String(stamp).slice(-6)}`, 'مقرر اختبار نشاط الطلاب'],
  );
  courseId = course.rows[0]!.id;
  const section=await client.query<{id:string;academic_year_id:string}>('select id,academic_year_id from app.academic_sections where level_id=$1 and status=\'active\' order by created_at limit 1',[level.rows[0]!.id]);
  assert.ok(section.rows[0],'An active academic section is required');
  const term=await client.query<{id:string}>('select id from app.academic_terms where academic_year_id=$1 order by term_number limit 1',[section.rows[0]!.academic_year_id]);
  assert.ok(term.rows[0],'A term is required in the section academic year');
  const offering = await client.query<{ id: string }>('insert into app.course_offerings(course_id,term_id,section_id,instructor_user_id,status) values($1,$2,$3,$4,\'active\') returning id', [courseId,term.rows[0]!.id,section.rows[0]!.id,ownerId]);
  offeringId = offering.rows[0]!.id;
  await client.query('insert into app.section_memberships(section_id,student_user_id,academic_year_id,status) values($1,$2,$3,\'active\')',[section.rows[0]!.id,studentId,section.rows[0]!.academic_year_id]);
  const activity = await client.query<{ id: string }>(
    `insert into app.learning_activities(offering_id,activity_type,title,description,status,points,available_from,source_type,created_by)
     values($1,'programming_practice',$2,$3,'published',10,now(),'practice_exercise',$4) returning id`,
    [offeringId, 'تدريب اختبار النشاط', 'تدريب مخصص لاختبار عزل بيانات نشاط الطلاب.', ownerId],
  );
  activityId = activity.rows[0]!.id;
  const exercise = await client.query<{ id: string }>(
    `insert into app.practice_exercises(title,description,execution_mode,difficulty,points,reference_solution,status,created_by,published_at,activity_id)
     values($1,$2,'stdin','easy',10,$3,'published',$4,now(),$5) returning id`,
    ['تدريب اختبار النشاط', 'تدريب مخصص لاختبار عزل بيانات نشاط الطلاب.', 'print(1)', ownerId, activityId],
  );
  exerciseId = exercise.rows[0]!.id;
  await client.query('update app.learning_activities set source_id=$2 where id=$1', [activityId, exerciseId]);
  const test = await client.query<{ id: string }>(
    `insert into app.practice_test_cases(exercise_id,input_payload,expected_payload,is_hidden,sort_order)
     values($1,'{"stdin":""}'::jsonb,'{"stdout":"1"}'::jsonb,false,0) returning id`, [exerciseId],
  );
  const attempt = await client.query<{ id: string }>(
    `insert into app.practice_attempts(exercise_id,student_user_id,attempt_number,source_code,status,passed_tests,total_tests,runtime_ms,completed_at)
     values($1,$2,1,'print(1)','passed',1,1,8,now()) returning id`, [exerciseId, studentId],
  );
  await client.query(
    `insert into app.practice_attempt_results(attempt_id,test_case_id,passed,runtime_ms,actual_output) values($1,$2,true,8,'1')`,
    [attempt.rows[0]!.id, test.rows[0]!.id],
  );
  await client.query(
    `insert into app.practice_completions(exercise_id,student_user_id,first_passing_attempt_id,points_awarded) values($1,$2,$3,10)`,
    [exerciseId, studentId, attempt.rows[0]!.id],
  );
  await client.query(
    `insert into app.student_point_ledger(student_user_id,exercise_id,attempt_id,points,reason)
     values($1,$2,$3,10,'practice_completion')`, [studentId, exerciseId, attempt.rows[0]!.id],
  );
  await client.query('commit');

  const accessClient=new pg.Client({connectionString:process.env.DATABASE_URL});
  await accessClient.connect();
  await accessClient.query('begin');
  await accessClient.query(`select set_config('app.user_id',$1,true),set_config('app.user_role','instructor',true)`,[ownerId]);
  const visibleMembership=await accessClient.query(`select m.student_user_id from app.course_offerings o join app.section_memberships m on m.section_id=o.section_id where o.id=$1 and m.status='active'`,[offeringId]);
  const visibleRoster=await accessClient.query(`select m.student_user_id from app.course_offerings o join app.section_memberships m on m.section_id=o.section_id join app.users u on u.id=m.student_user_id and u.role='student' and u.status='active' where o.id=$1 and o.status='active' and o.instructor_user_id=app.current_user_id() and m.status='active'`,[offeringId]);
  const visibleFullRoster=await accessClient.query(`with ao as (select o.id from app.course_offerings o join app.courses c on c.id=o.course_id join app.academic_terms t on t.id=o.term_id join app.academic_sections x on x.id=o.section_id where o.status='active' and c.is_active and o.instructor_user_id=app.current_user_id() and o.id=$1) select m.student_user_id from ao join app.course_offerings o on o.id=ao.id join app.section_memberships m on m.section_id=o.section_id where m.status='active'`,[offeringId]);
  await accessClient.query('rollback');await accessClient.end();
  assert.ok(visibleMembership.rows.some((row)=>row.student_user_id===studentId),JSON.stringify(visibleMembership.rows));
  assert.ok(visibleRoster.rows.some((row)=>row.student_user_id===studentId),JSON.stringify(visibleRoster.rows));
  assert.ok(visibleFullRoster.rows.some((row)=>row.student_user_id===studentId),JSON.stringify(visibleFullRoster.rows));

  app = await buildApp();
  const [admin, owner, outsider, student] = await Promise.all(inputs.map((input) => login(input.email)));
  const ownerList = await app.inject({ method: 'GET', url: `/api/v1/student-activity?offeringId=${offeringId}`, headers: { cookie: owner!.cookies } });
  assert.equal(ownerList.statusCode, 200, ownerList.body);
  const targetActivity = ownerList.json().students.find((entry: { studentId: string }) => entry.studentId === studentId);
  assert.ok(targetActivity, JSON.stringify(ownerList.json()));
  assert.equal(targetActivity.email, undefined, 'Activity list must not expose student contact data');
  assert.equal(targetActivity.status, 'completed');

  const adminList = await app.inject({ method: 'GET', url: `/api/v1/student-activity?offeringId=${offeringId}`, headers: { cookie: admin!.cookies } });
  assert.equal(adminList.statusCode, 200, adminList.body);
  assert.ok(adminList.json().summary.studentCount >= 1);

  const ownerDetail = await app.inject({ method: 'GET', url: `/api/v1/student-activity/${studentId}?offeringId=${offeringId}`, headers: { cookie: owner!.cookies } });
  assert.equal(ownerDetail.statusCode, 200, ownerDetail.body);
  assert.equal(ownerDetail.json().summary.completionRate, 100);
  assert.equal(ownerDetail.json().recentAttempts[0].sourceCode, undefined, 'Activity timeline must not expose source code');

  const outsiderList = await app.inject({ method: 'GET', url: `/api/v1/student-activity?offeringId=${offeringId}`, headers: { cookie: outsider!.cookies } });
  assert.equal(outsiderList.statusCode, 200, outsiderList.body);
  assert.equal(outsiderList.json().students.length, 0);
  const outsiderDetail = await app.inject({ method: 'GET', url: `/api/v1/student-activity/${studentId}?offeringId=${offeringId}`, headers: { cookie: outsider!.cookies } });
  assert.equal(outsiderDetail.statusCode, 404, outsiderDetail.body);
  const studentDenied = await app.inject({ method: 'GET', url: '/api/v1/student-activity', headers: { cookie: student!.cookies } });
  assert.equal(studentDenied.statusCode, 403, studentDenied.body);

  const attemptDetail = await app.inject({ method: 'GET', url: `/api/v1/practice/${exerciseId}/attempts/${attempt.rows[0]!.id}`, headers: { cookie: owner!.cookies } });
  assert.equal(attemptDetail.statusCode, 200, attemptDetail.body);
  assert.equal(attemptDetail.json().attempt.sourceCode, 'print(1)');
  const audit = await client.query(
    `select count(*)::int as count from app.audit_logs where actor_user_id=$1 and action='practice.attempt.view' and target_id=$2`,
    [ownerId, attempt.rows[0]!.id],
  );
  assert.equal(audit.rows[0].count, 1);
  console.log('Student activity role isolation, privacy, aggregation, drill-down, and audited source access smoke test passed.');
} finally {
  if (app) await app.close();
  if (exerciseId) await client.query('delete from app.practice_exercises where id=$1', [exerciseId]).catch(() => undefined);
  if (activityId) await client.query('delete from app.learning_activities where id=$1', [activityId]).catch(() => undefined);
  if (courseId) {
    await client.query('delete from app.course_offerings where course_id=$1', [courseId]).catch(() => undefined);
    await client.query('delete from app.courses where id=$1', [courseId]).catch(() => undefined);
  }
  if (userIds.length) {
    await client.query('delete from app.audit_logs where actor_user_id=any($1::uuid[]) or target_id=any($1::uuid[])', [userIds]).catch(() => undefined);
    await client.query('delete from app.users where id=any($1::uuid[])', [userIds]).catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}
