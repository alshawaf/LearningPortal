import 'dotenv/config';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_ADMIN_URL;
if (!databaseUrl) throw new Error('DATABASE_ADMIN_URL is required');

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query(
    `select e.id,c.code,c.title as course_title,u.display_name as instructor,
            e.title,e.description,e.execution_mode,e.function_name,e.difficulty,e.points,
            e.starter_code,e.reference_solution,e.comparison_mode,e.output_ignore_case,
            e.output_whitespace_mode,e.suppress_input_prompts,e.status,e.revision,e.sort_order,e.created_at,
            coalesce(json_agg(json_build_object(
              'input',t.input_payload,'expected',t.expected_payload,'hidden',t.is_hidden,
              'timeLimitMs',t.time_limit_ms,'order',t.sort_order
            ) order by t.sort_order) filter(where t.id is not null),'[]'::json) as tests
     from app.practice_exercises e
     join app.learning_activities a on a.id=e.activity_id
     join app.course_offerings o on o.id=a.offering_id
     join app.courses c on c.id=o.course_id
     join app.users u on u.id=e.created_by
     left join app.practice_test_cases t on t.exercise_id=e.id and t.revision=e.revision
     group by e.id,c.code,c.title,u.display_name
     order by c.code,e.sort_order,e.created_at`,
  );
  process.stdout.write(JSON.stringify(result.rows, null, 2));
} finally {
  await client.end();
}
