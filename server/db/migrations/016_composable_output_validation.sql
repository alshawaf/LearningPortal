begin;

drop function app.practice_execution_bundle(uuid);

alter table app.practice_exercises
  add column comparison_mode varchar(20),
  add column output_ignore_case boolean,
  add column output_whitespace_mode varchar(20);

update app.practice_exercises
set comparison_mode = case when output_check_mode = 'exact' then 'exact' else 'flexible' end,
    output_ignore_case = output_check_mode in ('case_insensitive', 'whitespace_case_insensitive'),
    output_whitespace_mode = case
      when output_check_mode in ('whitespace', 'whitespace_case_insensitive') then 'normalize'
      else 'exact'
    end;

alter table app.practice_exercises
  alter column comparison_mode set default 'exact',
  alter column comparison_mode set not null,
  alter column output_ignore_case set default false,
  alter column output_ignore_case set not null,
  alter column output_whitespace_mode set default 'exact',
  alter column output_whitespace_mode set not null,
  add constraint practice_exercises_comparison_mode_check
    check (comparison_mode in ('exact', 'flexible')),
  add constraint practice_exercises_output_whitespace_mode_check
    check (output_whitespace_mode in ('exact', 'normalize', 'remove')),
  add constraint practice_exercises_output_comparison_coherent
    check (
      (comparison_mode = 'exact' and output_ignore_case = false and output_whitespace_mode = 'exact')
      or
      (comparison_mode = 'flexible' and (output_ignore_case = true or output_whitespace_mode <> 'exact'))
    );

alter table app.practice_exercises
  drop column output_check_mode;

create function app.practice_execution_bundle(p_exercise_id uuid)
returns table (
  exercise_id uuid, course_id uuid, execution_mode varchar, function_name varchar,
  comparison_mode varchar, output_ignore_case boolean, output_whitespace_mode varchar,
  suppress_input_prompts boolean, revision integer,
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
         e.comparison_mode, e.output_ignore_case, e.output_whitespace_mode,
         e.suppress_input_prompts, e.revision, e.reference_solution,
         coalesce(jsonb_agg(jsonb_build_object(
           'id', t.id, 'inputPayload', t.input_payload, 'expectedPayload', t.expected_payload,
           'isHidden', t.is_hidden, 'timeLimitMs', t.time_limit_ms
         ) order by t.sort_order, t.id) filter (where t.id is not null), '[]'::jsonb)
  from app.practice_exercises e
  left join app.practice_test_cases t on t.exercise_id = e.id and t.revision = e.revision
  where e.id = p_exercise_id
  group by e.id;
end
$$;

revoke all on function app.practice_execution_bundle(uuid) from public;
grant execute on function app.practice_execution_bundle(uuid) to masar_api_access;

commit;
