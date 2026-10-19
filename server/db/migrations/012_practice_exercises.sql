begin;

create table app.practice_exercises (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references app.courses(id) on delete cascade,
  title varchar(180) not null check (char_length(trim(title)) between 3 and 180),
  description text not null check (char_length(trim(description)) between 10 and 20000),
  execution_mode varchar(20) not null check (execution_mode in ('stdin', 'function')),
  function_name varchar(80),
  difficulty varchar(20) not null check (difficulty in ('easy', 'medium', 'hard')),
  points integer not null check (points between 1 and 1000),
  starter_code text not null default '' check (char_length(starter_code) <= 100000),
  reference_solution text not null check (char_length(reference_solution) between 1 and 100000),
  status varchar(20) not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid not null references app.users(id) on delete restrict,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((execution_mode = 'function' and function_name ~ '^[A-Za-z_][A-Za-z0-9_]{0,79}$')
      or (execution_mode = 'stdin' and function_name is null))
);

create table app.practice_test_cases (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references app.practice_exercises(id) on delete cascade,
  input_payload jsonb not null check (jsonb_typeof(input_payload) = 'object'),
  expected_payload jsonb not null check (jsonb_typeof(expected_payload) = 'object'),
  is_hidden boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  time_limit_ms integer not null default 2000 check (time_limit_ms between 100 and 10000),
  memory_limit_mb integer not null default 64 check (memory_limit_mb between 32 and 256),
  created_at timestamptz not null default now()
);

create table app.practice_attempts (
  id uuid primary key default gen_random_uuid(),
  exercise_id uuid not null references app.practice_exercises(id) on delete cascade,
  student_user_id uuid not null references app.users(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  source_code text not null check (char_length(source_code) between 1 and 100000),
  status varchar(20) not null default 'running' check (status in ('running', 'passed', 'failed', 'error')),
  passed_tests integer not null default 0 check (passed_tests >= 0),
  total_tests integer not null default 0 check (total_tests >= 0),
  runtime_ms integer,
  error_category varchar(40),
  error_message varchar(1000),
  python_version varchar(30) not null default '3.12',
  submitted_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (exercise_id, student_user_id, attempt_number)
);

create table app.practice_attempt_results (
  id bigint generated always as identity primary key,
  attempt_id uuid not null references app.practice_attempts(id) on delete cascade,
  test_case_id uuid not null references app.practice_test_cases(id) on delete cascade,
  passed boolean not null,
  runtime_ms integer not null check (runtime_ms >= 0),
  actual_output text,
  error_message varchar(1000),
  unique (attempt_id, test_case_id)
);

create table app.practice_completions (
  exercise_id uuid not null references app.practice_exercises(id) on delete cascade,
  student_user_id uuid not null references app.users(id) on delete cascade,
  first_passing_attempt_id uuid not null references app.practice_attempts(id) on delete restrict,
  points_awarded integer not null check (points_awarded between 1 and 1000),
  completed_at timestamptz not null default now(),
  primary key (exercise_id, student_user_id)
);

create table app.student_point_ledger (
  id bigint generated always as identity primary key,
  student_user_id uuid not null references app.users(id) on delete cascade,
  course_id uuid not null references app.courses(id) on delete cascade,
  exercise_id uuid not null references app.practice_exercises(id) on delete cascade,
  attempt_id uuid not null references app.practice_attempts(id) on delete restrict,
  points integer not null check (points > 0),
  reason varchar(40) not null check (reason = 'practice_completion'),
  created_at timestamptz not null default now(),
  unique (student_user_id, exercise_id, reason)
);

create index practice_exercises_course_status_idx on app.practice_exercises(course_id, status, sort_order, created_at);
create index practice_test_cases_exercise_idx on app.practice_test_cases(exercise_id, sort_order);
create index practice_attempts_student_exercise_idx on app.practice_attempts(student_user_id, exercise_id, submitted_at desc);
create index practice_attempts_exercise_status_idx on app.practice_attempts(exercise_id, status, submitted_at desc);
create index practice_points_student_course_idx on app.student_point_ledger(student_user_id, course_id, created_at desc);

alter table app.practice_exercises enable row level security;
alter table app.practice_exercises force row level security;
alter table app.practice_test_cases enable row level security;
alter table app.practice_test_cases force row level security;
alter table app.practice_attempts enable row level security;
alter table app.practice_attempts force row level security;
alter table app.practice_attempt_results enable row level security;
alter table app.practice_attempt_results force row level security;
alter table app.practice_completions enable row level security;
alter table app.practice_completions force row level security;
alter table app.student_point_ledger enable row level security;
alter table app.student_point_ledger force row level security;

create policy practice_exercises_select on app.practice_exercises for select using (
  app.current_user_role() = 'admin'
  or (app.current_user_role() = 'instructor' and app.can_access_course(course_id, true))
  or (app.current_user_role() = 'student' and status = 'published' and app.can_access_course(course_id, false))
);
create policy practice_exercises_write on app.practice_exercises for all
  using (app.current_user_role() = 'admin' or (app.current_user_role() = 'instructor' and app.can_access_course(course_id, true)))
  with check (app.current_user_role() = 'admin' or (app.current_user_role() = 'instructor' and app.can_access_course(course_id, true)));

create policy practice_tests_manage on app.practice_test_cases for all using (
  (not is_hidden and exists (select 1 from app.practice_exercises e where e.id = exercise_id
    and e.status = 'published' and app.current_user_role() = 'student' and app.can_access_course(e.course_id, false)))
  or exists (select 1 from app.practice_exercises e where e.id = exercise_id
    and (app.current_user_role() = 'admin' or (app.current_user_role() = 'instructor' and app.can_access_course(e.course_id, true))))
) with check (
  exists (select 1 from app.practice_exercises e where e.id = exercise_id
    and (app.current_user_role() = 'admin' or (app.current_user_role() = 'instructor' and app.can_access_course(e.course_id, true))))
);

create policy practice_attempts_select on app.practice_attempts for select using (
  student_user_id = app.current_user_id() or app.current_user_role() = 'admin'
  or exists (select 1 from app.practice_exercises e where e.id = exercise_id and app.can_access_course(e.course_id, true))
);
create policy practice_attempts_insert on app.practice_attempts for insert with check (
  app.current_user_role() = 'student' and student_user_id = app.current_user_id()
  and exists (select 1 from app.practice_exercises e where e.id = exercise_id and e.status = 'published' and app.can_access_course(e.course_id, false))
);
create policy practice_attempts_update on app.practice_attempts for update using (
  student_user_id = app.current_user_id()
) with check (student_user_id = app.current_user_id());

create policy practice_results_select on app.practice_attempt_results for select using (
  exists (select 1 from app.practice_attempts a where a.id = attempt_id and (
    a.student_user_id = app.current_user_id() or app.current_user_role() = 'admin'
    or exists (select 1 from app.practice_exercises e where e.id = a.exercise_id and app.can_access_course(e.course_id, true))
  ))
);
create policy practice_results_insert on app.practice_attempt_results for insert with check (
  exists (select 1 from app.practice_attempts a where a.id = attempt_id and a.student_user_id = app.current_user_id())
);

create policy practice_completions_select on app.practice_completions for select using (
  student_user_id = app.current_user_id() or app.current_user_role() = 'admin'
  or exists (select 1 from app.practice_exercises e where e.id = exercise_id and app.can_access_course(e.course_id, true))
);
create policy practice_completions_insert on app.practice_completions for insert with check (student_user_id = app.current_user_id());
create policy practice_points_select on app.student_point_ledger for select using (
  student_user_id = app.current_user_id() or app.current_user_role() = 'admin'
  or app.can_access_course(course_id, true)
);
create policy practice_points_insert on app.student_point_ledger for insert with check (student_user_id = app.current_user_id());

create function app.practice_execution_bundle(p_exercise_id uuid)
returns table (
  exercise_id uuid, course_id uuid, execution_mode varchar, function_name varchar,
  reference_solution text, test_cases jsonb
)
language plpgsql stable security definer
set search_path = app, pg_temp
as $$
begin
  if not exists (
    select 1 from app.practice_exercises e where e.id = p_exercise_id and (
      app.current_user_role() = 'admin'
      or (app.current_user_role() = 'instructor' and app.can_access_course(e.course_id, true))
      or (app.current_user_role() = 'student' and e.status = 'published' and app.can_access_course(e.course_id, false))
    )
  ) then raise insufficient_privilege; end if;

  return query
  select e.id, e.course_id, e.execution_mode, e.function_name, e.reference_solution,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'inputPayload', t.input_payload, 'expectedPayload', t.expected_payload,
           'isHidden', t.is_hidden, 'timeLimitMs', t.time_limit_ms
         ) order by t.sort_order, t.id) filter (where t.id is not null), '[]'::jsonb)
  from app.practice_exercises e
  left join app.practice_test_cases t on t.exercise_id = e.id
  where e.id = p_exercise_id
  group by e.id;
end
$$;

grant select, insert, update, delete on app.practice_exercises, app.practice_test_cases to masar_api_access;
grant select, insert, update on app.practice_attempts, app.practice_attempt_results, app.practice_completions, app.student_point_ledger to masar_api_access;
grant usage, select on sequence app.practice_attempt_results_id_seq, app.student_point_ledger_id_seq to masar_api_access;
revoke all on function app.practice_execution_bundle(uuid) from public;
grant execute on function app.practice_execution_bundle(uuid) to masar_api_access;

commit;
