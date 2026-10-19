begin;

alter table app.practice_exercises
  add column output_check_mode varchar(30) not null default 'exact'
    check (output_check_mode in ('exact', 'whitespace', 'tokens')),
  add column suppress_input_prompts boolean not null default true;

drop function app.practice_execution_bundle(uuid);

create function app.practice_execution_bundle(p_exercise_id uuid)
returns table (
  exercise_id uuid, course_id uuid, execution_mode varchar, function_name varchar,
  output_check_mode varchar, suppress_input_prompts boolean,
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
  select e.id, e.course_id, e.execution_mode, e.function_name,
         e.output_check_mode, e.suppress_input_prompts, e.reference_solution,
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

revoke all on function app.practice_execution_bundle(uuid) from public;
grant execute on function app.practice_execution_bundle(uuid) to masar_api_access;

commit;
