import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';
import { buildApp } from '../app.js';
import { hashPassword } from '../security/password.js';
import { runPython } from '../services/practice-execution-client.js';

const databaseUrl = process.env.DATABASE_ADMIN_URL;
const origin = process.env.WEB_ORIGIN;
if (!databaseUrl || !origin) throw new Error('DATABASE_ADMIN_URL and WEB_ORIGIN are required');

const stamp = Date.now();
const suffix = String(stamp).slice(-7);
const password = 'Practice-Privacy-Smoke-2026!';
const client = new pg.Client({ connectionString: databaseUrl });
const userIds: string[] = [];
let courseId: string | null = null;
let offeringId: string | null = null;
let exerciseId: string | null = null;
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
  const levels = await client.query<{ id: string }>('select id from app.academic_levels where is_active order by created_at, id limit 2');
  assert.ok(levels.rows[0], 'At least one active academic level is required');
  const passwordHash = await hashPassword(password);
  const inputs = [
    { email: `practice.admin.${stamp}@example.edu`, phone: `+96771${suffix}`, name: 'مدير اختبار التدريبات', role: 'admin', level: null },
    { email: `practice.owner.${stamp}@example.edu`, phone: `+96772${suffix}`, name: 'أستاذ التدريبات', role: 'instructor', level: null },
    { email: `practice.outsider.${stamp}@example.edu`, phone: `+96773${suffix}`, name: 'أستاذ خارج المقرر', role: 'instructor', level: null },
    { email: `practice.student.${stamp}@example.edu`, phone: `+96774${suffix}`, name: 'طالب التدريبات', role: 'student', level: levels.rows[0]!.id },
  ];
  await client.query('begin');
  for (const input of inputs) {
    const created = await client.query<{ id: string }>(
      'insert into app.users(email, phone_e164, display_name, role, academic_level_id) values ($1::citext,$2,$3,$4,$5) returning id',
      [input.email, input.phone, input.name, input.role, input.level],
    );
    userIds.push(created.rows[0]!.id);
    await client.query('insert into app.password_credentials(user_id, password_hash) values ($1,$2)', [created.rows[0]!.id, passwordHash]);
  }
  await client.query('commit');

  app = await buildApp();
  const [adminId, ownerId] = userIds;
  const [admin, owner, outsider, student] = await Promise.all(inputs.map((input) => login(input.email)));
  const courseResponse = await app.inject({
    method: 'POST', url: '/api/v1/courses', headers: { origin, cookie: admin!.cookies, 'x-csrf-token': admin!.csrf },
    payload: { code: `PR${String(stamp).slice(-6)}`, title: 'مقرر اختبار التدريبات' },
  });
  assert.equal(courseResponse.statusCode, 201, courseResponse.body);
  courseId = courseResponse.json().course.id;
  const delivery=await app.inject({method:'GET',url:'/api/v1/course-offerings',headers:{cookie:admin!.cookies}});
  assert.equal(delivery.statusCode,200,delivery.body);
  const targetSection=delivery.json().sections.find((item:{levelId:string;status:string})=>item.levelId===levels.rows[0]!.id&&item.status==='active');
  assert.ok(targetSection,'An active section is required for the practice smoke test');
  const targetTerm=delivery.json().terms.find((item:{academicYearId:string;status:string})=>item.academicYearId===targetSection.academicYearId&&item.status==='active')??delivery.json().terms.find((item:{academicYearId:string})=>item.academicYearId===targetSection.academicYearId);
  assert.ok(targetTerm,'A term in the section academic year is required');
  const membership=await app.inject({method:'POST',url:`/api/v1/course-offerings/sections/${targetSection.id}/students`,headers:{origin,cookie:admin!.cookies,'x-csrf-token':admin!.csrf},payload:{studentId:userIds[3]}});
  assert.equal(membership.statusCode,201,membership.body);
  const offering=await app.inject({method:'POST',url:'/api/v1/course-offerings',headers:{origin,cookie:admin!.cookies,'x-csrf-token':admin!.csrf},payload:{courseId,termId:targetTerm.id,sectionId:targetSection.id,instructorUserId:ownerId,status:'active'}});
  assert.equal(offering.statusCode,201,offering.body);
  offeringId=offering.json().id;

  const exercisePayload = {
    offeringId, title: 'مجموع عددين', description: 'اقرأ عددين صحيحين ثم اطبع مجموعهما في سطر واحد.',
    executionMode: 'stdin', functionName: null, difficulty: 'easy', points: 15,
    starterCode: 'a, b = map(int, input().split())\n# اكتب الحل هنا\n',
    referenceSolution: 'a, b = map(int, input().split())\nprint(a + b)\n',
    tests: [
      { inputPayload: { stdin: '2 3\n' }, expectedPayload: { stdout: '5\n' }, isHidden: false, timeLimitMs: 2000 },
      { inputPayload: { stdin: '-9 4\n' }, expectedPayload: { stdout: '-5\n' }, isHidden: true, timeLimitMs: 2000 },
    ],
  };
  const generatedPreview = await app.inject({
    method: 'POST', url: '/api/v1/practice/preview', headers: { origin, cookie: owner!.cookies, 'x-csrf-token': owner!.csrf },
    payload: {
      executionMode: 'stdin', functionName: null, referenceSolution: exercisePayload.referenceSolution, suppressInputPrompts: true,
      tests: exercisePayload.tests.map(({ inputPayload, isHidden, timeLimitMs }) => ({ inputPayload, isHidden, timeLimitMs })),
    },
  });
  assert.equal(generatedPreview.statusCode, 200, generatedPreview.body);
  assert.deepEqual(generatedPreview.json().outputs, [{ stdout: '5' }, { stdout: '-5' }], 'Reference solution must generate expected outputs');
  const created = await app.inject({ method: 'POST', url: '/api/v1/practice', headers: { origin, cookie: owner!.cookies, 'x-csrf-token': owner!.csrf }, payload: exercisePayload });
  assert.equal(created.statusCode, 201, created.body);
  exerciseId = created.json().id as string;

  const outsiderDenied = await app.inject({ method: 'GET', url: `/api/v1/practice/${exerciseId}`, headers: { cookie: outsider!.cookies } });
  assert.equal(outsiderDenied.statusCode, 404, outsiderDenied.body);
  const prePublishStudent = await app.inject({ method: 'GET', url: '/api/v1/practice', headers: { cookie: student!.cookies } });
  assert.equal(prePublishStudent.statusCode, 200, prePublishStudent.body);
  assert.equal(prePublishStudent.json().exercises.some((entry: { id: string }) => entry.id === exerciseId), false);

  const published = await app.inject({ method: 'PATCH', url: `/api/v1/practice/${exerciseId}/status`, headers: { origin, cookie: owner!.cookies, 'x-csrf-token': owner!.csrf }, payload: { status: 'published' } });
  assert.equal(published.statusCode, 200, published.body);

  const studentDetail = await app.inject({ method: 'GET', url: `/api/v1/practice/${exerciseId}`, headers: { cookie: student!.cookies } });
  assert.equal(studentDetail.statusCode, 200, studentDetail.body);
  assert.equal(studentDetail.json().exercise.referenceSolution, null);
  assert.equal(studentDetail.json().exercise.tests.length, 1, 'Hidden test cases must not be returned to students');

  const preview = await app.inject({ method: 'POST', url: `/api/v1/practice/${exerciseId}/run`, headers: { origin, cookie: student!.cookies, 'x-csrf-token': student!.csrf }, payload: { sourceCode: exercisePayload.referenceSolution } });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.equal(preview.json().official, false);
  assert.equal(preview.json().result.passed, true);
  const attemptsAfterPreview = await client.query('select count(*)::int as count from app.practice_attempts where exercise_id=$1', [exerciseId]);
  assert.equal(attemptsAfterPreview.rows[0].count, 0, 'Preview must not create an official attempt');

  const badSubmit = await app.inject({ method: 'POST', url: `/api/v1/practice/${exerciseId}/submit`, headers: { origin, cookie: student!.cookies, 'x-csrf-token': student!.csrf }, payload: { sourceCode: 'print(0)' } });
  assert.equal(badSubmit.statusCode, 200, badSubmit.body);
  assert.equal(badSubmit.json().result.passed, false);
  assert.equal(badSubmit.json().result.results[1].hidden, true);
  assert.equal(badSubmit.json().result.results[1].actualOutput, null);

  const goodSubmit = await app.inject({ method: 'POST', url: `/api/v1/practice/${exerciseId}/submit`, headers: { origin, cookie: student!.cookies, 'x-csrf-token': student!.csrf }, payload: { sourceCode: exercisePayload.referenceSolution } });
  assert.equal(goodSubmit.statusCode, 200, goodSubmit.body);
  assert.equal(goodSubmit.json().attempt.pointsAwarded, 15);
  const repeatedSubmit = await app.inject({ method: 'POST', url: `/api/v1/practice/${exerciseId}/submit`, headers: { origin, cookie: student!.cookies, 'x-csrf-token': student!.csrf }, payload: { sourceCode: exercisePayload.referenceSolution } });
  assert.equal(repeatedSubmit.statusCode, 200, repeatedSubmit.body);
  assert.equal(repeatedSubmit.json().attempt.pointsAwarded, 0, 'Points must only be awarded once');

  const studentRosterDenied = await app.inject({ method: 'GET', url: `/api/v1/practice/${exerciseId}/students`, headers: { cookie: student!.cookies } });
  assert.equal(studentRosterDenied.statusCode, 403, studentRosterDenied.body);
  const outsiderRosterDenied = await app.inject({ method: 'GET', url: `/api/v1/practice/${exerciseId}/students`, headers: { cookie: outsider!.cookies } });
  assert.equal(outsiderRosterDenied.statusCode, 404, outsiderRosterDenied.body);
  const ownerRoster = await app.inject({ method: 'GET', url: `/api/v1/practice/${exerciseId}/students`, headers: { cookie: owner!.cookies } });
  assert.equal(ownerRoster.statusCode, 200, ownerRoster.body);
  const studentSummaryRow = ownerRoster.json().students.find((entry: { studentId: string }) => entry.studentId === userIds[3]);
  assert.equal(studentSummaryRow.attemptCount, 3);
  assert.equal(studentSummaryRow.pointsAwarded, 15);
  assert.equal(studentSummaryRow.email, undefined, 'Teacher roster must not expose student email');
  const studentAttempts = await app.inject({ method: 'GET', url: `/api/v1/practice/${exerciseId}/students/${userIds[3]}/attempts`, headers: { cookie: owner!.cookies } });
  assert.equal(studentAttempts.statusCode, 200, studentAttempts.body);
  assert.equal(studentAttempts.json().attempts.length, 3);
  const passingAttemptId = goodSubmit.json().attempt.id as string;
  const attemptDetail = await app.inject({ method: 'GET', url: `/api/v1/practice/${exerciseId}/attempts/${passingAttemptId}`, headers: { cookie: owner!.cookies } });
  assert.equal(attemptDetail.statusCode, 200, attemptDetail.body);
  assert.equal(attemptDetail.json().attempt.sourceCode, exercisePayload.referenceSolution);
  assert.equal(attemptDetail.json().attempt.results.length, 2);
  const viewAudit = await client.query("select count(*)::int as count from app.audit_logs where actor_user_id=$1 and action='practice.attempt.view' and target_id=$2", [ownerId, passingAttemptId]);
  assert.equal(viewAudit.rows[0].count, 1, 'Opening student source must create an audit entry');

  const historicalResultsBeforeEdit = await client.query('select count(*)::int as count from app.practice_attempt_results where attempt_id=$1', [passingAttemptId]);
  const publishedEdit = await app.inject({ method: 'PATCH', url: `/api/v1/practice/${exerciseId}`,
    headers: { origin, cookie: owner!.cookies, 'x-csrf-token': owner!.csrf },
    payload: { ...exercisePayload, description: 'اقرأ عددين صحيحين ثم اطبع مجموعهما في سطر واحد بعد التحديث.' } });
  assert.equal(publishedEdit.statusCode, 200, publishedEdit.body);
  const revisionState = await client.query<{ revision: number; current_tests: number; all_tests: number }>(
    `select e.revision,
            (select count(*)::int from app.practice_test_cases t where t.exercise_id=e.id and t.revision=e.revision) as current_tests,
            (select count(*)::int from app.practice_test_cases t where t.exercise_id=e.id) as all_tests
     from app.practice_exercises e where e.id=$1`, [exerciseId],
  );
  assert.equal(Number(revisionState.rows[0]!.revision), 2, 'Editing a published practice must create a new revision');
  assert.equal(Number(revisionState.rows[0]!.current_tests), 2);
  assert.equal(Number(revisionState.rows[0]!.all_tests), 4, 'Previous test revision must be preserved');
  const historicalResultsAfterEdit = await client.query('select count(*)::int as count from app.practice_attempt_results where attempt_id=$1', [passingAttemptId]);
  assert.equal(historicalResultsAfterEdit.rows[0].count, historicalResultsBeforeEdit.rows[0].count, 'Published edits must preserve historical attempt results');
  const editedDetail = await app.inject({ method: 'GET', url: `/api/v1/practice/${exerciseId}`, headers: { cookie: owner!.cookies } });
  assert.equal(editedDetail.statusCode, 200, editedDetail.body);
  assert.equal(editedDetail.json().exercise.revision, 2);
  assert.equal(editedDetail.json().exercise.tests.length, 2, 'Only the current test revision may be returned');

  const ledger = await client.query('select count(*)::int as count, sum(points)::int as points from app.student_point_ledger where exercise_id=$1', [exerciseId]);
  assert.equal(ledger.rows[0].count, 1);
  assert.equal(ledger.rows[0].points, 15);
  const studentSummary = await app.inject({ method: 'GET', url: '/api/v1/practice', headers: { cookie: student!.cookies } });
  assert.equal(studentSummary.json().stats.totalPoints, 15);
  assert.equal(studentSummary.json().stats.completedCount, 1);
  assert.equal(studentSummary.json().stats.attemptCount, 3);
  const functionMode = await runPython({
    source: 'def multiply(a, b):\n    return a * b\n', mode: 'function', functionName: 'multiply',
    tests: [{ id: 'function-mode-smoke', inputPayload: { arguments: [6, 7] }, expectedPayload: { return: 42 }, isHidden: true, timeLimitMs: 2_000 }],
  });
  assert.equal(functionMode.passed, true, 'Function execution mode must support JSON arguments and return values');
  const promptSolution = 'x = int(input("Enter your No"))\nprint("Even" if x % 2 == 0 else "Odd")\n';
  const promptTests = [
    { id: 'prompt-even', inputPayload: { stdin: '8\n' }, expectedPayload: { stdout: 'Even\n' }, isHidden: false, timeLimitMs: 2_000 },
    { id: 'prompt-odd', inputPayload: { stdin: '-3\n' }, expectedPayload: { stdout: 'Odd\n' }, isHidden: true, timeLimitMs: 2_000 },
  ];
  const promptsSuppressed = await runPython({ source: promptSolution, mode: 'stdin', functionName: null,
    comparisonMode: 'exact', suppressInputPrompts: true, tests: promptTests });
  assert.equal(promptsSuppressed.passed, true, 'input() prompts must not contaminate judged stdout when suppression is enabled');
  const promptsVisible = await runPython({ source: promptSolution, mode: 'stdin', functionName: null,
    comparisonMode: 'exact', suppressInputPrompts: false, tests: promptTests });
  assert.equal(promptsVisible.passed, false, 'input() prompts must remain observable when suppression is disabled');
  const whitespaceCheck = await runPython({ source: 'print("Even", "Number")\n', mode: 'stdin', functionName: null,
    comparisonMode: 'flexible', whitespaceMode: 'normalize', tests: [{ id: 'whitespace-check', inputPayload: { stdin: '' }, expectedPayload: { stdout: 'Even\nNumber\n' }, isHidden: true, timeLimitMs: 2_000 }] });
  assert.equal(whitespaceCheck.passed, true, 'Whitespace comparison must ignore spaces and line breaks');
  const caseInsensitiveCheck = await runPython({ source: 'print("eVeN")\n', mode: 'stdin', functionName: null,
    comparisonMode: 'flexible', ignoreCase: true, tests: [{ id: 'case-check', inputPayload: { stdin: '' }, expectedPayload: { stdout: 'EVEN\n' }, isHidden: true, timeLimitMs: 2_000 }] });
  assert.equal(caseInsensitiveCheck.passed, true, 'Case-insensitive comparison must ignore letter casing');
  const caseInsensitiveKeepsWhitespace = await runPython({ source: 'print("Even Number")\n', mode: 'stdin', functionName: null,
    comparisonMode: 'flexible', ignoreCase: true, tests: [{ id: 'case-whitespace-check', inputPayload: { stdin: '' }, expectedPayload: { stdout: 'EVEN\nNUMBER\n' }, isHidden: true, timeLimitMs: 2_000 }] });
  assert.equal(caseInsensitiveKeepsWhitespace.passed, false, 'Case-insensitive comparison must retain whitespace differences');
  const combinedCheck = await runPython({ source: 'print("eVeN", "nUmBeR")\n', mode: 'stdin', functionName: null,
    comparisonMode: 'flexible', ignoreCase: true, whitespaceMode: 'normalize', tests: [{ id: 'combined-check', inputPayload: { stdin: '' }, expectedPayload: { stdout: 'EVEN\nNUMBER\n' }, isHidden: true, timeLimitMs: 2_000 }] });
  assert.equal(combinedCheck.passed, true, 'Combined comparison must ignore both whitespace and letter casing');
  const removeWhitespaceCheck = await runPython({ source: 'print("This Number Is aMultiple of7")\n', mode: 'stdin', functionName: null,
    comparisonMode: 'flexible', ignoreCase: true, whitespaceMode: 'remove', tests: [{ id: 'remove-whitespace-check', inputPayload: { stdin: '' }, expectedPayload: { stdout: 'This number is a multiple of 7\n' }, isHidden: true, timeLimitMs: 2_000 }] });
  assert.equal(removeWhitespaceCheck.passed, true, 'Remove-whitespace and case-insensitive rules must compose for equivalent text');
  const automaticTextCheck = await runPython({ source: 'print("This Number Is aMultiple of7")\n', mode: 'stdin', functionName: null,
    comparisonMode: 'auto', tests: [{ id: 'automatic-text-check', inputPayload: { stdin: '' }, expectedPayload: { stdout: 'This number is a multiple of 7\n' }, isHidden: true, timeLimitMs: 2_000 }] });
  assert.equal(automaticTextCheck.passed, true, 'Automatic comparison must ignore non-semantic text formatting');
  const automaticOppositeCheck = await runPython({ source: 'print("This number is not a multiple of 7")\n', mode: 'stdin', functionName: null,
    comparisonMode: 'auto', tests: [{ id: 'automatic-opposite-check', inputPayload: { stdin: '' }, expectedPayload: { stdout: 'This number is a multiple of 7\n' }, isHidden: true, timeLimitMs: 2_000 }] });
  assert.equal(automaticOppositeCheck.passed, false, 'Automatic comparison must preserve meaningful words such as not');
  const automaticNumericCheck = await runPython({ source: 'print("The result is: 42")\n', mode: 'stdin', functionName: null,
    comparisonMode: 'auto', tests: [{ id: 'automatic-numeric-check', inputPayload: { stdin: '' }, expectedPayload: { stdout: '42\n' }, isHidden: true, timeLimitMs: 2_000 }] });
  assert.equal(automaticNumericCheck.passed, true, 'Automatic comparison must extract numeric answers from explanatory output');
  assert.ok(adminId);
  console.log('Practice isolation, output validation, prompt suppression, hidden tests, attempts, and one-time points smoke test passed.');
} finally {
  if (app) await app.close();
  if (courseId) {
    if (exerciseId) await client.query('delete from app.practice_exercises where id=$1', [exerciseId]).catch(() => undefined);
    await client.query(`delete from app.learning_activities where offering_id in (select id from app.course_offerings where course_id=$1)`, [courseId]).catch(() => undefined);
    await client.query('delete from app.course_offerings where course_id=$1', [courseId]).catch(() => undefined);
    await client.query('delete from app.courses where id=$1', [courseId]).catch(() => undefined);
  }
  if (userIds.length) {
    await client.query('delete from app.audit_logs where actor_user_id=any($1::uuid[]) or target_id=any($1::uuid[])', [userIds]).catch(() => undefined);
    await client.query('delete from app.users where id=any($1::uuid[])', [userIds]).catch(() => undefined);
  }
  await client.end().catch(() => undefined);
}
