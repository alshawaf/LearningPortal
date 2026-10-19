import type { PoolClient } from 'pg';
import type { AuthUser } from '../domain/auth.js';
import { withUserContext } from '../db/pool.js';
import type { ComparisonMode, OutputWhitespaceMode, RunnerCase, RunnerResult } from '../services/practice-runner-contracts.js';

export type ExerciseInput = {
  offeringId: string; title: string; description: string; executionMode: 'stdin' | 'function';
  functionName: string | null; difficulty: 'easy' | 'medium' | 'hard'; points: number;
  starterCode: string; referenceSolution: string;
  comparisonMode: ComparisonMode; ignoreCase: boolean; whitespaceMode: OutputWhitespaceMode; suppressInputPrompts: boolean;
  autoGenerateExpected: boolean;
  tests: Array<{ inputPayload: Record<string, unknown>; expectedPayload: Record<string, unknown>; isHidden: boolean; timeLimitMs: number }>;
};

type BundleRow = {
  exercise_id: string; offering_id: string; execution_mode: 'stdin' | 'function'; function_name: string | null;
  comparison_mode: ComparisonMode; output_ignore_case: boolean; output_whitespace_mode: OutputWhitespaceMode;
  suppress_input_prompts: boolean; revision: number; reference_solution: string; test_cases: RunnerCase[];
};

export class PracticeRepository {
  list(user: AuthUser) {
    return withUserContext(user, async (client) => {
      const result = await client.query(
        `select e.id, a.offering_id, c.code as course_code, c.title as course_title,t.name as term_name,x.code as section_code,
                e.title, e.description, e.execution_mode, e.function_name, e.comparison_mode, e.output_ignore_case,
                e.output_whitespace_mode, e.suppress_input_prompts, e.difficulty,
                e.points, e.starter_code, e.status, e.revision, e.sort_order, e.published_at, e.created_at, e.updated_at,
                (select count(*) from app.practice_test_cases t where t.exercise_id = e.id and t.revision=e.revision) as test_count,
                (select count(*) from app.practice_attempts a where a.exercise_id = e.id) as attempt_count,
                (select count(*) from app.practice_completions pc where pc.exercise_id = e.id) as completion_count,
                exists (select 1 from app.practice_completions pc where pc.exercise_id = e.id and pc.student_user_id = app.current_user_id()) as completed,
                coalesce((select max(a.attempt_number) from app.practice_attempts a where a.exercise_id = e.id and a.student_user_id = app.current_user_id()), 0) as my_attempt_count
         from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
         join app.course_offerings o on o.id=a.offering_id join app.courses c on c.id=o.course_id
         join app.academic_sections x on x.id=o.section_id
         join app.academic_terms t on t.id=o.term_id
         order by c.code, e.sort_order, e.created_at`,
      );
      return result.rows.map(mapExercise);
    });
  }

  studentStats(user: AuthUser) {
    if (user.role !== 'student') return Promise.resolve(null);
    return withUserContext(user, async (client) => {
      const result = await client.query(
        `select
           coalesce((select sum(points) from app.student_point_ledger where student_user_id=app.current_user_id()), 0) as total_points,
           (select count(*) from app.practice_completions where student_user_id=app.current_user_id()) as completed_count,
           (select count(*) from app.practice_attempts where student_user_id=app.current_user_id()) as attempt_count`,
      );
      return {
        totalPoints: Number(result.rows[0].total_points),
        completedCount: Number(result.rows[0].completed_count),
        attemptCount: Number(result.rows[0].attempt_count),
      };
    });
  }

  get(user: AuthUser, exerciseId: string) {
    return withUserContext(user, async (client) => {
      const exerciseResult = await client.query(
        `select e.id, a.offering_id, c.code as course_code, c.title as course_title,t.name as term_name,x.code as section_code,
                e.title, e.description, e.execution_mode, e.function_name, e.comparison_mode, e.output_ignore_case,
                e.output_whitespace_mode, e.suppress_input_prompts, e.difficulty,
                e.points, e.starter_code, e.status, e.revision, e.sort_order, e.published_at, e.created_at, e.updated_at,
                case when app.current_user_role() in ('admin', 'instructor') then e.reference_solution else null end as reference_solution,
                (select count(*) from app.practice_test_cases t where t.exercise_id = e.id and t.revision=e.revision) as test_count,
                (select count(*) from app.practice_attempts a where a.exercise_id = e.id) as attempt_count,
                (select count(*) from app.practice_completions pc where pc.exercise_id = e.id) as completion_count,
                exists (select 1 from app.practice_completions pc where pc.exercise_id = e.id and pc.student_user_id = app.current_user_id()) as completed,
                coalesce((select max(a.attempt_number) from app.practice_attempts a where a.exercise_id = e.id and a.student_user_id = app.current_user_id()), 0) as my_attempt_count
         from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
         join app.course_offerings o on o.id=a.offering_id join app.courses c on c.id=o.course_id
         join app.academic_sections x on x.id=o.section_id
         join app.academic_terms t on t.id=o.term_id where e.id = $1`, [exerciseId],
      );
      if (!exerciseResult.rows[0]) return null;
      const testsResult = await client.query(
        `select id, input_payload, expected_payload, is_hidden, sort_order, time_limit_ms
         from app.practice_test_cases
         where exercise_id = $1 and revision=(select revision from app.practice_exercises where id=$1)
         order by sort_order, id`, [exerciseId],
      );
      const attemptsResult = user.role === 'student' ? await client.query(
        `select id, attempt_number, status, passed_tests, total_tests, runtime_ms,
                error_category, error_message, submitted_at, completed_at
         from app.practice_attempts where exercise_id = $1 and student_user_id = app.current_user_id()
         order by attempt_number desc limit 20`, [exerciseId],
      ) : { rows: [] };
      return {
        ...mapExercise(exerciseResult.rows[0]), referenceSolution: exerciseResult.rows[0].reference_solution,
        tests: testsResult.rows.map((row) => ({ id: row.id, inputPayload: row.input_payload, expectedPayload: row.expected_payload,
          isHidden: row.is_hidden, sortOrder: row.sort_order, timeLimitMs: row.time_limit_ms })),
        attempts: attemptsResult.rows.map(mapAttempt),
      };
    });
  }

  listStudents(user: AuthUser, exerciseId: string) {
    return withUserContext(user, async (client) => {
      const exerciseResult = await client.query(
        `select e.id,e.title,a.offering_id,c.code as course_code,c.title as course_title,e.points
         from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
         join app.course_offerings o on o.id=a.offering_id join app.courses c on c.id=o.course_id where e.id=$1`, [exerciseId],
      );
      if (!exerciseResult.rows[0]) throw notFoundError();
      const studentsResult = await client.query(
        `select u.id as student_id, u.display_name,
                count(a.id) as attempt_count,
                max(a.submitted_at) as last_attempt_at,
                (array_agg(a.status order by a.attempt_number desc) filter (where a.id is not null))[1] as latest_status,
                coalesce(max(a.passed_tests), 0) as best_passed_tests,
                coalesce(max(a.total_tests), 0) as total_tests,
                pc.completed_at, pc.points_awarded
         from app.practice_exercises e join app.learning_activities la on la.id=e.activity_id
         join app.course_offerings o on o.id=la.offering_id join app.section_memberships cm on cm.section_id=o.section_id and cm.status='active'
         join app.users u on u.id=cm.student_user_id and u.role='student' and u.status='active'
         left join app.practice_attempts a on a.exercise_id=e.id and a.student_user_id=u.id
         left join app.practice_completions pc on pc.exercise_id=e.id and pc.student_user_id=u.id
         where e.id=$1
         group by u.id, pc.completed_at, pc.points_awarded
         order by (pc.completed_at is not null) desc, max(a.submitted_at) desc nulls last, u.display_name`, [exerciseId],
      );
      const students = studentsResult.rows.map((row) => ({
        studentId: row.student_id, displayName: row.display_name, attemptCount: Number(row.attempt_count),
        lastAttemptAt: row.last_attempt_at, latestStatus: row.latest_status,
        bestPassedTests: Number(row.best_passed_tests), totalTests: Number(row.total_tests),
        completedAt: row.completed_at, pointsAwarded: Number(row.points_awarded ?? 0),
      }));
      const exercise = exerciseResult.rows[0];
      return {
        exercise: { id: exercise.id, title: exercise.title, offeringId: exercise.offering_id,
          courseCode: exercise.course_code, courseTitle: exercise.course_title, points: Number(exercise.points) },
        summary: {
          studentCount: students.length,
          attemptedCount: students.filter((student) => student.attemptCount > 0).length,
          completedCount: students.filter((student) => Boolean(student.completedAt)).length,
          attemptCount: students.reduce((sum, student) => sum + student.attemptCount, 0),
        },
        students,
      };
    });
  }

  listStudentAttempts(user: AuthUser, exerciseId: string, studentId: string) {
    return withUserContext(user, async (client) => {
      const studentResult = await client.query(
        `select u.id, u.display_name
         from app.practice_exercises e join app.learning_activities la on la.id=e.activity_id
         join app.course_offerings o on o.id=la.offering_id join app.section_memberships cm on cm.section_id=o.section_id and cm.student_user_id=$2
         join app.users u on u.id=cm.student_user_id
         where e.id=$1`, [exerciseId, studentId],
      );
      if (!studentResult.rows[0]) throw notFoundError();
      const attemptsResult = await client.query(
        `select id, attempt_number, status, passed_tests, total_tests, runtime_ms,
                error_category, error_message, submitted_at, completed_at
         from app.practice_attempts
         where exercise_id=$1 and student_user_id=$2
         order by attempt_number desc limit 100`, [exerciseId, studentId],
      );
      return { student: { id: studentResult.rows[0].id, displayName: studentResult.rows[0].display_name }, attempts: attemptsResult.rows.map(mapAttempt) };
    });
  }

  getAttempt(user: AuthUser, exerciseId: string, attemptId: string) {
    return withUserContext(user, async (client) => {
      const attemptResult = await client.query(
        `select a.id, a.exercise_id, a.student_user_id, u.display_name as student_name,
                a.attempt_number, a.source_code, a.status, a.passed_tests, a.total_tests,
                a.runtime_ms, a.error_category, a.error_message, a.python_version,
                a.submitted_at, a.completed_at
         from app.practice_attempts a
         join app.practice_exercises e on e.id=a.exercise_id
         join app.users u on u.id=a.student_user_id
         where a.id=$1 and a.exercise_id=$2`, [attemptId, exerciseId],
      );
      const row = attemptResult.rows[0];
      if (!row) throw notFoundError();
      const results = await client.query(
        `select r.id, r.passed, r.runtime_ms, r.actual_output, r.error_message,
                t.is_hidden, t.sort_order
         from app.practice_attempt_results r
         join app.practice_test_cases t on t.id=r.test_case_id
         where r.attempt_id=$1 order by t.sort_order, r.id`, [attemptId],
      );
      await client.query(`select app.write_audit($1, 'practice.attempt.view', 'practice_attempt', $2, $3::jsonb, null)`, [
        user.id, attemptId, JSON.stringify({ exerciseId, studentId: row.student_user_id }),
      ]);
      return {
        id: row.id, exerciseId: row.exercise_id, studentUserId: row.student_user_id, studentName: row.student_name,
        attemptNumber: Number(row.attempt_number), sourceCode: row.source_code, status: row.status,
        passedTests: Number(row.passed_tests), totalTests: Number(row.total_tests), runtimeMs: row.runtime_ms,
        errorCategory: row.error_category, errorMessage: row.error_message, pythonVersion: row.python_version,
        submittedAt: row.submitted_at, completedAt: row.completed_at,
        results: results.rows.map((result, index) => ({ number: index + 1, hidden: result.is_hidden,
          passed: result.passed, runtimeMs: result.runtime_ms, actualOutput: result.actual_output, errorMessage: result.error_message })),
      };
    });
  }

  create(user: AuthUser, input: ExerciseInput) {
    return withUserContext(user, async (client) => {
      const activity = await client.query<{ id: string }>(
        `insert into app.learning_activities(
           offering_id,activity_type,title,description,status,points,source_type,created_by
         ) values ($1,'programming_practice',$2,$3,'draft',$4,'practice_exercise',$5)
         returning id`,
        [input.offeringId, input.title, input.description, input.points, user.id],
      );
      const created = await client.query<{ id: string }>(
        `insert into app.practice_exercises(
          title, description, execution_mode, function_name, comparison_mode, output_ignore_case,
          output_whitespace_mode, suppress_input_prompts, difficulty,
          points, starter_code, reference_solution, created_by, activity_id
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
        [input.title, input.description, input.executionMode, input.functionName,
          input.comparisonMode, input.ignoreCase, input.whitespaceMode, input.suppressInputPrompts, input.difficulty,
          input.points, input.starterCode, input.referenceSolution, user.id, activity.rows[0]!.id],
      );
      const id = created.rows[0]!.id;
      await client.query('update app.learning_activities set source_id=$2 where id=$1', [activity.rows[0]!.id, id]);
      await insertTests(client, id, 1, input.tests);
      await client.query(`select app.write_audit($1, 'practice.create', 'practice_exercise', $2, $3::jsonb, null)`, [
        user.id, id, JSON.stringify({ offeringId: input.offeringId, title: input.title }),
      ]);
      return id;
    });
  }

  update(user: AuthUser, exerciseId: string, input: ExerciseInput) {
    return withUserContext(user, async (client) => {
      const current = await client.query<{ status: string; revision: number; activity_id: string }>(
        'select status, revision, activity_id from app.practice_exercises where id=$1 for update', [exerciseId],
      );
      if (!current.rows[0] || current.rows[0].status === 'archived') throw notFoundError();
      const previousRevision = Number(current.rows[0].revision);
      const nextRevision = current.rows[0].status === 'published' ? previousRevision + 1 : previousRevision;
      const updated = await client.query(
        `update app.practice_exercises set title=$2, description=$3, execution_mode=$4,
                function_name=$5, comparison_mode=$6, output_ignore_case=$7, output_whitespace_mode=$8,
                suppress_input_prompts=$9, difficulty=$10, points=$11,
                starter_code=$12, reference_solution=$13, revision=$14, updated_at=now()
         where id=$1 and status in ('draft','published') returning id`,
        [exerciseId, input.title, input.description, input.executionMode, input.functionName,
          input.comparisonMode, input.ignoreCase, input.whitespaceMode, input.suppressInputPrompts, input.difficulty,
          input.points, input.starterCode, input.referenceSolution, nextRevision],
      );
      if (!updated.rowCount) throw notFoundError();
      await client.query(
        `update app.learning_activities set offering_id=$2,title=$3,description=$4,
                points=$5,updated_at=now() where id=$1`,
        [current.rows[0].activity_id, input.offeringId, input.title, input.description, input.points],
      );
      if (current.rows[0].status === 'draft') {
        await client.query('delete from app.practice_test_cases where exercise_id = $1 and revision=$2', [exerciseId, previousRevision]);
      }
      await insertTests(client, exerciseId, nextRevision, input.tests);
      await client.query(`select app.write_audit($1, 'practice.update', 'practice_exercise', $2, $3::jsonb, null)`, [
        user.id, exerciseId, JSON.stringify({ offeringId: input.offeringId, title: input.title, status: current.rows[0].status,
          previousRevision, revision: nextRevision }),
      ]);
    });
  }

  setStatus(user: AuthUser, exerciseId: string, status: 'published' | 'archived') {
    return withUserContext(user, async (client) => {
      const result = await client.query(
        `update app.practice_exercises set status=$2::varchar,
                published_at=case when $2::varchar='published' then coalesce(published_at, now()) else published_at end,
                updated_at=now() where id=$1 returning id,activity_id`, [exerciseId, status],
      );
      if (!result.rowCount) throw notFoundError();
      await client.query(
        `update app.learning_activities set status=$2::varchar,
                available_from=case when $2::varchar='published' then coalesce(available_from,now()) else available_from end,
                updated_at=now() where id=$1`,
        [result.rows[0].activity_id, status],
      );
      await client.query(`select app.write_audit($1, 'practice.status.update', 'practice_exercise', $2, $3::jsonb, null)`, [
        user.id, exerciseId, JSON.stringify({ status }),
      ]);
    });
  }

  executionBundle(user: AuthUser, exerciseId: string) {
    return withUserContext(user, async (client) => {
      const result = await client.query<BundleRow>('select * from app.practice_execution_bundle($1)', [exerciseId]);
      const row = result.rows[0];
      if (!row) throw notFoundError();
      return { exerciseId: row.exercise_id, offeringId: row.offering_id, executionMode: row.execution_mode,
        functionName: row.function_name, comparisonMode: row.comparison_mode, ignoreCase: row.output_ignore_case,
        whitespaceMode: row.output_whitespace_mode, suppressInputPrompts: row.suppress_input_prompts,
        revision: Number(row.revision), referenceSolution: row.reference_solution, tests: row.test_cases };
    });
  }

  startAttempt(user: AuthUser, exerciseId: string, exerciseRevision: number, sourceCode: string) {
    return withUserContext(user, async (client) => {
      await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [`practice:${exerciseId}:${user.id}`]);
      const result = await client.query(
        `insert into app.practice_attempts(exercise_id, student_user_id, attempt_number, exercise_revision, source_code)
         select $1, $2, coalesce(max(attempt_number), 0) + 1, $3, $4
         from app.practice_attempts where exercise_id=$1 and student_user_id=$2
         returning id, attempt_number`, [exerciseId, user.id, exerciseRevision, sourceCode],
      );
      return { id: result.rows[0].id as string, attemptNumber: Number(result.rows[0].attempt_number) };
    });
  }

  finishAttempt(user: AuthUser, attemptId: string, exerciseId: string, result: RunnerResult) {
    return withUserContext(user, async (client) => {
      const status = result.passed ? 'passed' : result.results.some((item) => item.errorMessage) ? 'error' : 'failed';
      await client.query(
        `update app.practice_attempts set status=$2, passed_tests=$3, total_tests=$4, runtime_ms=$5,
                error_category=$6, error_message=$7, completed_at=now()
         where id=$1 and student_user_id=app.current_user_id()`,
        [attemptId, status, result.results.filter((item) => item.passed).length, result.results.length,
          result.runtimeMs, status === 'error' ? 'runtime' : null,
          result.results.find((item) => item.errorMessage)?.errorMessage ?? null],
      );
      for (const item of result.results) {
        await client.query(
          `insert into app.practice_attempt_results(attempt_id, test_case_id, passed, runtime_ms, actual_output, error_message)
           values ($1,$2,$3,$4,$5,$6)`,
          [attemptId, item.testCaseId, item.passed, item.runtimeMs, item.actualOutput, item.errorMessage],
        );
      }
      let pointsAwarded = 0;
      if (result.passed) {
        const completion = await client.query<{ points_awarded: number }>(
          `insert into app.practice_completions(exercise_id, student_user_id, first_passing_attempt_id, points_awarded)
           select e.id, app.current_user_id(), $2, e.points from app.practice_exercises e where e.id=$1
           on conflict (exercise_id, student_user_id) do nothing returning points_awarded`, [exerciseId, attemptId],
        );
        pointsAwarded = Number(completion.rows[0]?.points_awarded ?? 0);
        if (pointsAwarded) {
          await client.query(
            `insert into app.student_point_ledger(student_user_id, exercise_id, attempt_id, points, reason)
             select app.current_user_id(), e.id, $2, $3, 'practice_completion'
             from app.practice_exercises e where e.id=$1 on conflict do nothing`, [exerciseId, attemptId, pointsAwarded],
          );
        }
      }
      return { id: attemptId, status, passedTests: result.results.filter((item) => item.passed).length,
        totalTests: result.results.length, runtimeMs: result.runtimeMs, pointsAwarded };
    });
  }

  failAttempt(user: AuthUser, attemptId: string, message: string) {
    return withUserContext(user, async (client) => {
      await client.query(
        `update app.practice_attempts set status='error', error_category='infrastructure',
                error_message=$2, completed_at=now()
         where id=$1 and student_user_id=app.current_user_id()`,
        [attemptId, message.slice(0, 1000)],
      );
    });
  }
}

async function insertTests(client: PoolClient, exerciseId: string, revision: number, tests: ExerciseInput['tests']) {
  for (let index = 0; index < tests.length; index += 1) {
    const test = tests[index]!;
    await client.query(
      `insert into app.practice_test_cases(exercise_id,revision,input_payload,expected_payload,is_hidden,sort_order,time_limit_ms)
       values ($1,$2,$3::jsonb,$4::jsonb,$5,$6,$7)`,
      [exerciseId, revision, JSON.stringify(test.inputPayload), JSON.stringify(test.expectedPayload), test.isHidden, index, test.timeLimitMs],
    );
  }
}

function mapExercise(row: Record<string, unknown>) {
  return {
    id: row.id, offeringId: row.offering_id, courseCode: row.course_code, courseTitle: row.course_title,
    termName: row.term_name, sectionCode: row.section_code,
    title: row.title, description: row.description, executionMode: row.execution_mode, functionName: row.function_name,
    comparisonMode: row.comparison_mode, ignoreCase: row.output_ignore_case,
    whitespaceMode: row.output_whitespace_mode, suppressInputPrompts: row.suppress_input_prompts,
    difficulty: row.difficulty, points: Number(row.points), starterCode: row.starter_code, status: row.status, revision: Number(row.revision),
    sortOrder: Number(row.sort_order), testCount: Number(row.test_count), attemptCount: Number(row.attempt_count),
    completionCount: Number(row.completion_count), completed: row.completed, myAttemptCount: Number(row.my_attempt_count),
    publishedAt: row.published_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function mapAttempt(row: Record<string, unknown>) {
  return { id: row.id, attemptNumber: Number(row.attempt_number), status: row.status,
    passedTests: Number(row.passed_tests), totalTests: Number(row.total_tests), runtimeMs: row.runtime_ms,
    errorCategory: row.error_category, errorMessage: row.error_message, submittedAt: row.submitted_at, completedAt: row.completed_at };
}

function notFoundError() {
  const error = new Error('Practice exercise not found') as Error & { code: string };
  error.code = 'P0002';
  return error;
}
