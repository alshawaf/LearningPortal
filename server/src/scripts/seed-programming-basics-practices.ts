import 'dotenv/config';
import assert from 'node:assert/strict';
import pg from 'pg';
import type { AuthUser } from '../domain/auth.js';
import { pool } from '../db/pool.js';
import { PracticeRepository, type ExerciseInput } from '../repositories/practice-repository.js';
import { generateExpectedPayloads, runPython } from '../services/practice-execution-client.js';
import type { RunnerCase } from '../services/practice-runner-contracts.js';

const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
if (!databaseAdminUrl) throw new Error('DATABASE_ADMIN_URL is required');

const instructorName = 'أ. مصطفى عمر حاج السيؤني';
const courseTitle = 'اساسيات البرمجة';
const testTimeLimitMs = 2_000;

type DraftDefinition = Omit<ExerciseInput, 'offeringId' | 'tests'> & { inputs: string[] };

const definitions: DraftDefinition[] = [
  {
    title: 'حساب مساحة الدائرة',
    description: 'قم بكتابة برنامج يستقبل نصف قطر الدائرة من المُستخدم، ثم يقوم بحساب وطباعة مساحة الدائرة باستخدام القيمة 3.14 للثابت π، مقربة إلى منزلتين عشريتين.',
    executionMode: 'stdin', functionName: null, difficulty: 'easy', points: 10,
    starterCode: 'radius = float(input())\n# اكتب الحل هنا\n',
    referenceSolution: 'radius = float(input())\narea = 3.14 * radius ** 2\nprint(round(area, 2))\n',
    comparisonMode: 'auto', ignoreCase: false, whitespaceMode: 'exact', suppressInputPrompts: true,
    autoGenerateExpected: true,
    inputs: ['1\n', '2\n', '3\n', '5\n', '7\n', '10\n', '12\n'],
  },
  {
    title: 'نسبة الحضور وأهلية دخول الاختبار',
    description: 'قم بكتابة برنامج يستقبل عدد المحاضرات التي حضرها الطالب، ثم عدد المحاضرات الكلي، ويحسب نسبة الحضور. إذا كانت النسبة 75% أو أكثر يطبع (Eligible)، وإلا يطبع (Not Eligible).',
    executionMode: 'stdin', functionName: null, difficulty: 'medium', points: 10,
    starterCode: 'attended = int(input())\ntotal = int(input())\n# اكتب الحل هنا\n',
    referenceSolution: 'attended = int(input())\ntotal = int(input())\npercentage = attended / total * 100\nif percentage >= 75:\n    print("Eligible")\nelse:\n    print("Not Eligible")\n',
    comparisonMode: 'auto', ignoreCase: false, whitespaceMode: 'exact', suppressInputPrompts: true,
    autoGenerateExpected: true,
    inputs: ['15\n20\n', '14\n20\n', '18\n20\n', '3\n4\n', '2\n3\n', '0\n10\n', '10\n10\n', '74\n100\n'],
  },
  {
    title: 'التحقق من اسم المستخدم وكلمة المرور',
    description: 'قم بكتابة برنامج يُعرّف اسم المستخدم الصحيح بالقيمة (admin) وكلمة المرور الصحيحة بالقيمة (Python123)، ثم يستقبل اسم المستخدم وكلمة المرور. إذا تطابقت القيمتان يطبع (Login Successful)، وإلا يطبع (Login Failed).',
    executionMode: 'stdin', functionName: null, difficulty: 'medium', points: 10,
    starterCode: 'correct_username = "admin"\ncorrect_password = "Python123"\nusername = input()\npassword = input()\n# اكتب الحل هنا\n',
    referenceSolution: 'correct_username = "admin"\ncorrect_password = "Python123"\nusername = input()\npassword = input()\nif username == correct_username and password == correct_password:\n    print("Login Successful")\nelse:\n    print("Login Failed")\n',
    comparisonMode: 'auto', ignoreCase: false, whitespaceMode: 'exact', suppressInputPrompts: true,
    autoGenerateExpected: true,
    inputs: ['admin\nPython123\n', 'admin\nWrong123\n', 'student\nPython123\n', 'ADMIN\nPython123\n', 'admin\npython123\n', '\nPython123\n', 'admin\n\n', 'student\nwrong\n'],
  },
  {
    title: 'إيجاد العدد الأكبر',
    description: 'قم بكتابة برنامج يستقبل ثلاثة أعداد من المُستخدم، ثم يقوم بالمُقارنة بينها وطباعة العدد الأكبر.',
    executionMode: 'stdin', functionName: null, difficulty: 'medium', points: 10,
    starterCode: 'first = float(input())\nsecond = float(input())\nthird = float(input())\n# اكتب الحل هنا\n',
    referenceSolution: 'first = float(input())\nsecond = float(input())\nthird = float(input())\nlargest = max(first, second, third)\nprint(f"{largest:g}")\n',
    comparisonMode: 'auto', ignoreCase: false, whitespaceMode: 'exact', suppressInputPrompts: true,
    autoGenerateExpected: true,
    inputs: ['3\n7\n5\n', '10\n2\n1\n', '1\n2\n9\n', '-5\n-2\n-8\n', '4\n4\n2\n', '0\n0\n0\n', '2.5\n7.1\n3.2\n', '100\n-100\n50\n'],
  },
  {
    title: 'آلة حاسبة بسيطة',
    description: 'قم بكتابة برنامج يستقبل رقمين من المُستخدم، ثم يستقبل رمز العملية الحسابية المطلوبة (+ أو - أو * أو /)، ثم يقوم بطباعة ناتج العملية.',
    executionMode: 'stdin', functionName: null, difficulty: 'medium', points: 10,
    starterCode: 'first = float(input())\nsecond = float(input())\noperator = input().strip()\n# اكتب الحل هنا\n',
    referenceSolution: 'first = float(input())\nsecond = float(input())\noperator = input().strip()\nif operator == "+":\n    result = first + second\nelif operator == "-":\n    result = first - second\nelif operator == "*":\n    result = first * second\nelse:\n    result = first / second\nprint(f"{result:g}")\n',
    comparisonMode: 'auto', ignoreCase: false, whitespaceMode: 'exact', suppressInputPrompts: true,
    autoGenerateExpected: true,
    inputs: ['5\n3\n+\n', '10\n4\n-\n', '6\n7\n*\n', '20\n5\n/\n', '-3\n8\n+\n', '2.5\n4\n*\n', '7\n2\n/\n', '0\n9\n-\n'],
  },
];

const adminClient = new pg.Client({ connectionString: databaseAdminUrl });
const repository = new PracticeRepository();

try {
  await adminClient.connect();
  const instructorResult = await adminClient.query<{
    id: string; email: string; phone_e164: string | null; display_name: string; role: AuthUser['role']; must_change_password: boolean;
  }>(
    `select u.id, u.email::text, u.phone_e164, u.display_name, u.role, pc.must_change_password
     from app.users u
     join app.password_credentials pc on pc.user_id=u.id
     where regexp_replace(u.display_name, '\\s+', ' ', 'g') = $1 and u.role = 'instructor' and u.status = 'active'`,
    [instructorName],
  );
  assert.equal(instructorResult.rowCount, 1, `Expected exactly one active instructor named ${instructorName}`);
  const instructorRow = instructorResult.rows[0]!;
  const instructor: AuthUser = {
    id: instructorRow.id,
    email: instructorRow.email,
    phone: instructorRow.phone_e164,
    displayName: instructorRow.display_name,
    role: instructorRow.role,
    mustChangePassword: instructorRow.must_change_password,
  };

  const courseResult = await adminClient.query<{ id: string; offering_id: string; code: string; title: string; instructor_user_id: string }>(
    `select c.id,o.id as offering_id,c.code,c.title,o.instructor_user_id
     from app.courses c join app.course_offerings o on o.course_id=c.id and o.instructor_user_id=$2 and o.status='active'
     where regexp_replace(c.title, '\\s+', ' ', 'g')=$1 and c.is_active`,
    [courseTitle, instructor.id],
  );
  assert.equal(courseResult.rowCount, 1, `Expected exactly one active offering for ${courseTitle} assigned to the instructor`);
  const course = courseResult.rows[0]!;

  const prepared: ExerciseInput[] = [];
  for (const definition of definitions) {
    assert.ok(definition.inputs.length >= 6 && definition.inputs.length <= 8, `${definition.title}: test count must be between 6 and 8`);
    const probeTests = definition.inputs.map((stdin, index) => ({
      id: `${index + 1}`,
      inputPayload: { stdin },
      isHidden: index !== 0,
      timeLimitMs: testTimeLimitMs,
    }));
    const outputs = await generateExpectedPayloads({
      source: definition.referenceSolution,
      mode: definition.executionMode,
      functionName: definition.functionName,
      suppressInputPrompts: definition.suppressInputPrompts,
      tests: probeTests,
    });
    const runnerTests: RunnerCase[] = probeTests.map((test, index) => ({ ...test, expectedPayload: outputs[index]! }));
    const validation = await runPython({
      source: definition.referenceSolution,
      mode: definition.executionMode,
      functionName: definition.functionName,
      comparisonMode: definition.comparisonMode,
      ignoreCase: definition.ignoreCase,
      whitespaceMode: definition.whitespaceMode,
      suppressInputPrompts: definition.suppressInputPrompts,
      tests: runnerTests,
    });
    assert.equal(validation.passed, true, `${definition.title}: reference solution failed its generated tests`);
    const { inputs: _inputs, ...exercise } = definition;
    prepared.push({
      ...exercise,
      offeringId: course.offering_id,
      tests: runnerTests.map((test) => ({
        inputPayload: test.inputPayload,
        expectedPayload: test.expectedPayload,
        isHidden: test.isHidden,
        timeLimitMs: test.timeLimitMs,
      })),
    });
  }

  const created: Array<{ id: string; title: string }> = [];
  const skipped: Array<{ id: string; title: string }> = [];
  for (const exercise of prepared) {
    const existing = await adminClient.query<{ id: string; status: string; comparison_mode: string; test_count: number }>(
      `select e.id, e.status, e.comparison_mode,
              (select count(*)::int from app.practice_test_cases t where t.exercise_id=e.id and t.revision=e.revision) as test_count
       from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
       where a.offering_id=$1 and e.title=$2`,
      [course.offering_id, exercise.title],
    );
    if (existing.rows[0]) {
      const row = existing.rows[0];
      assert.equal(row.status, 'draft', `${exercise.title}: existing exercise is not a draft`);
      assert.equal(row.comparison_mode, 'auto', `${exercise.title}: existing exercise does not use smart evaluation`);
      assert.ok(Number(row.test_count) >= 6 && Number(row.test_count) <= 8, `${exercise.title}: existing test count is outside 6-8`);
      skipped.push({ id: row.id, title: exercise.title });
      continue;
    }
    const id = await repository.create(instructor, exercise);
    created.push({ id, title: exercise.title });
  }

  const verification = await adminClient.query<{
    id: string; title: string; status: string; comparison_mode: string; created_by: string; test_count: number; visible_count: number; hidden_count: number;
  }>(
    `select e.id, e.title, e.status, e.comparison_mode, e.created_by,
            count(t.id)::int as test_count,
            count(t.id) filter (where not t.is_hidden)::int as visible_count,
            count(t.id) filter (where t.is_hidden)::int as hidden_count
     from app.practice_exercises e
     join app.practice_test_cases t on t.exercise_id=e.id and t.revision=e.revision
     join app.learning_activities a on a.id=e.activity_id
     where a.offering_id=$1 and e.title=any($2::text[])
     group by e.id
     order by e.created_at`,
    [course.offering_id, definitions.map((item) => item.title)],
  );
  assert.equal(verification.rowCount, definitions.length, 'Not all requested exercises exist');
  for (const row of verification.rows) {
    assert.equal(row.status, 'draft');
    assert.equal(row.comparison_mode, 'auto');
    assert.equal(row.created_by, instructor.id);
    assert.ok(Number(row.test_count) >= 6 && Number(row.test_count) <= 8);
    assert.equal(Number(row.visible_count), 1);
    assert.equal(Number(row.hidden_count), Number(row.test_count) - 1);
  }

  console.log(JSON.stringify({
    instructor: instructor.displayName,
    course: `${course.code} - ${course.title}`,
    created,
    skipped,
    exercises: verification.rows,
  }, null, 2));
} finally {
  await Promise.allSettled([adminClient.end(), pool.end()]);
}
