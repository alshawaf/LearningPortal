begin;

-- Remove integration-test catalog data. The authored SED112 practices remain and
-- are migrated below; their complete content was exported before this cutover.
create temporary table cutover_test_courses(id uuid primary key) on commit drop;
insert into cutover_test_courses(id)
select id from app.courses where code ~ '^(PR|ACT|AR)[0-9]+$';
delete from app.practice_exercises where course_id in (select id from cutover_test_courses);
delete from app.assignments where course_id in (select id from cutover_test_courses);
delete from app.learning_activities where offering_id in (
  select id from app.course_offerings where course_id in (select id from cutover_test_courses)
);
delete from app.course_offering_members where offering_id in (
  select id from app.course_offerings where course_id in (select id from cutover_test_courses)
);
delete from app.course_offerings where course_id in (select id from cutover_test_courses);
delete from app.course_members where course_id in (select id from cutover_test_courses);
delete from app.courses where id in (select id from cutover_test_courses);

-- The former LEGACY term is now the real current term. There is no compatibility
-- offering after this migration.
update app.academic_terms
set code='CURRENT', name='الفصل الأكاديمي الحالي', is_system=true, updated_at=now()
where code='LEGACY';
drop index if exists app.course_offerings_one_legacy_per_course;
update app.course_offerings set is_legacy=false where is_legacy;

-- Stop all dual writes before changing the specialized activity tables.
drop trigger if exists course_members_sync_legacy_offering on app.course_members;
drop trigger if exists courses_sync_legacy_offering on app.courses;
drop trigger if exists courses_auto_enroll_students on app.courses;
drop trigger if exists students_auto_enroll_courses on app.users;
drop trigger if exists practice_ensure_learning_activity on app.practice_exercises;
drop trigger if exists assignment_ensure_learning_activity on app.assignments;
drop trigger if exists practice_sync_learning_activity on app.practice_exercises;
drop trigger if exists assignment_sync_learning_activity on app.assignments;

drop function if exists app.practice_execution_bundle(uuid);
drop function if exists app.sync_legacy_course_offering();
drop function if exists app.resolve_course_offering(uuid);
drop function if exists app.sync_course_students(uuid,uuid);
drop function if exists app.admin_add_course_student(uuid,uuid,uuid);
drop function if exists app.admin_set_course_enrollment_status(uuid,uuid,uuid,varchar,varchar);
drop function if exists app.auto_enroll_for_course_change();
drop function if exists app.auto_enroll_for_student_change();
drop function if exists app.ensure_practice_learning_activity();
drop function if exists app.ensure_assignment_learning_activity();
drop function if exists app.sync_practice_learning_activity();
drop function if exists app.sync_assignment_learning_activity();

-- Every specialized activity now reaches its course context through activity_id
-- -> learning_activities.offering_id. Remove the duplicated course foreign keys.
drop policy if exists practice_exercises_select on app.practice_exercises;
drop policy if exists practice_exercises_write on app.practice_exercises;
drop policy if exists practice_tests_manage on app.practice_test_cases;
drop policy if exists practice_attempts_select on app.practice_attempts;
drop policy if exists practice_attempts_insert on app.practice_attempts;
drop policy if exists practice_results_select on app.practice_attempt_results;
drop policy if exists practice_completions_select on app.practice_completions;
drop policy if exists practice_points_select on app.student_point_ledger;
drop policy if exists assignments_select_policy on app.assignments;
drop policy if exists assignments_write_policy on app.assignments;
drop policy if exists submissions_select_policy on app.submissions;
drop policy if exists submissions_insert_policy on app.submissions;
drop policy if exists submissions_grade_policy on app.submissions;

drop index if exists app.practice_exercises_course_status_idx;
drop index if exists app.practice_points_student_course_idx;
drop index if exists app.assignments_course_id_idx;
alter table app.student_point_ledger drop column course_id;
alter table app.practice_exercises drop column course_id;
alter table app.assignments drop column course_id;

alter table app.course_offerings drop column is_legacy;

-- Course catalog access is derived solely from offerings and offering members.
create or replace function app.can_access_course(p_course_id uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path=app,pg_temp as $$
  select case
    when app.current_user_id() is null then false
    when app.current_user_role()='admin' then true
    when exists (
      select 1 from app.course_offerings o
      where o.course_id=p_course_id and o.instructor_user_id=app.current_user_id()
    ) then true
    when not p_write and exists (
      select 1 from app.course_offerings o
      join app.course_offering_members m on m.offering_id=o.id
      where o.course_id=p_course_id and o.status='active'
        and m.user_id=app.current_user_id() and m.enrollment_status='active'
    ) then true
    else false end
$$;

drop policy if exists users_select_policy on app.users;
create policy users_select_policy on app.users for select using (
  id=app.current_user_id() or app.current_user_role()='admin'
  or (
    app.current_user_role()='instructor' and exists (
      select 1 from app.course_offering_members m
      join app.course_offerings o on o.id=m.offering_id
      where m.user_id=users.id and m.membership_role='student'
        and o.instructor_user_id=app.current_user_id()
    )
  )
  or exists (
    select 1 from app.course_offerings o
    where o.instructor_user_id=users.id and app.can_access_offering(o.id,false)
  )
);

create policy practice_exercises_select on app.practice_exercises for select using (
  exists (select 1 from app.learning_activities a where a.id=activity_id
    and app.can_access_offering(a.offering_id,false)
    and (status='published' or app.can_access_offering(a.offering_id,true)))
);
create policy practice_exercises_write on app.practice_exercises for all
  using (exists (select 1 from app.learning_activities a where a.id=activity_id and app.can_access_offering(a.offering_id,true)))
  with check (exists (select 1 from app.learning_activities a where a.id=activity_id and app.can_access_offering(a.offering_id,true)));

create policy practice_tests_manage on app.practice_test_cases for all using (
  exists (select 1 from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
    where e.id=exercise_id and app.can_access_offering(a.offering_id,false)
      and ((not is_hidden and e.status='published') or app.can_access_offering(a.offering_id,true)))
) with check (
  exists (select 1 from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
    where e.id=exercise_id and app.can_access_offering(a.offering_id,true))
);
create policy practice_attempts_select on app.practice_attempts for select using (
  student_user_id=app.current_user_id() or app.current_user_role()='admin'
  or exists (select 1 from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
    where e.id=exercise_id and app.can_access_offering(a.offering_id,true))
);
create policy practice_attempts_insert on app.practice_attempts for insert with check (
  app.current_user_role()='student' and student_user_id=app.current_user_id()
  and exists (select 1 from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
    where e.id=exercise_id and e.status='published' and app.can_access_offering(a.offering_id,false))
);
create policy practice_results_select on app.practice_attempt_results for select using (
  exists (select 1 from app.practice_attempts pa
    join app.practice_exercises e on e.id=pa.exercise_id
    join app.learning_activities a on a.id=e.activity_id
    where pa.id=attempt_id and (pa.student_user_id=app.current_user_id()
      or app.current_user_role()='admin' or app.can_access_offering(a.offering_id,true)))
);
create policy practice_completions_select on app.practice_completions for select using (
  student_user_id=app.current_user_id() or app.current_user_role()='admin'
  or exists (select 1 from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
    where e.id=exercise_id and app.can_access_offering(a.offering_id,true))
);
create policy practice_points_select on app.student_point_ledger for select using (
  student_user_id=app.current_user_id() or app.current_user_role()='admin'
  or exists (select 1 from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
    where e.id=exercise_id and app.can_access_offering(a.offering_id,true))
);

create policy assignments_select_policy on app.assignments for select using (
  exists (select 1 from app.learning_activities a where a.id=activity_id
    and app.can_access_offering(a.offering_id,false)
    and (published_at is not null or app.can_access_offering(a.offering_id,true)))
);
create policy assignments_write_policy on app.assignments for all
  using (exists (select 1 from app.learning_activities a where a.id=activity_id and app.can_access_offering(a.offering_id,true)))
  with check (exists (select 1 from app.learning_activities a where a.id=activity_id and app.can_access_offering(a.offering_id,true)));
create policy submissions_select_policy on app.submissions for select using (
  student_user_id=app.current_user_id() or app.current_user_role()='admin'
  or exists (select 1 from app.assignments x join app.learning_activities a on a.id=x.activity_id
    where x.id=assignment_id and app.can_access_offering(a.offering_id,true))
);
create policy submissions_insert_policy on app.submissions for insert with check (
  app.current_user_role()='student' and student_user_id=app.current_user_id()
  and exists (select 1 from app.assignments x join app.learning_activities a on a.id=x.activity_id
    where x.id=assignment_id and x.published_at is not null and app.can_access_offering(a.offering_id,false))
);
create policy submissions_grade_policy on app.submissions for update
  using (app.current_user_role()='admin' or exists (
    select 1 from app.assignments x join app.learning_activities a on a.id=x.activity_id
    where x.id=assignment_id and app.can_access_offering(a.offering_id,true)
  )) with check (app.current_user_role()='admin' or exists (
    select 1 from app.assignments x join app.learning_activities a on a.id=x.activity_id
    where x.id=assignment_id and app.can_access_offering(a.offering_id,true)
  ));

create function app.practice_execution_bundle(p_exercise_id uuid)
returns table (
  exercise_id uuid, offering_id uuid, execution_mode varchar, function_name varchar,
  comparison_mode varchar, output_ignore_case boolean, output_whitespace_mode varchar,
  suppress_input_prompts boolean, revision integer, reference_solution text, test_cases jsonb
)
language plpgsql stable security definer set search_path=app,pg_temp as $$
begin
  if not exists (
    select 1 from app.practice_exercises e join app.learning_activities a on a.id=e.activity_id
    where e.id=p_exercise_id and app.can_access_offering(a.offering_id,false)
      and (e.status='published' or app.can_access_offering(a.offering_id,true))
  ) then raise insufficient_privilege; end if;
  return query
  select e.id,a.offering_id,e.execution_mode,e.function_name,e.comparison_mode,
         e.output_ignore_case,e.output_whitespace_mode,e.suppress_input_prompts,e.revision,e.reference_solution,
         coalesce(jsonb_agg(jsonb_build_object(
           'id',t.id,'inputPayload',t.input_payload,'expectedPayload',t.expected_payload,
           'isHidden',t.is_hidden,'timeLimitMs',t.time_limit_ms
         ) order by t.sort_order,t.id) filter(where t.id is not null),'[]'::jsonb)
  from app.practice_exercises e
  join app.learning_activities a on a.id=e.activity_id
  left join app.practice_test_cases t on t.exercise_id=e.id and t.revision=e.revision
  where e.id=p_exercise_id group by e.id,a.offering_id;
end $$;

-- Native offering enrollment operations.
create function app.sync_offering_students(p_actor_id uuid,p_offering_id uuid)
returns integer language plpgsql security definer set search_path=app,pg_temp as $$
declare v_level_id uuid; v_status varchar; v_inserted integer:=0;
begin
  if p_actor_id is distinct from app.current_user_id() or app.current_user_role()<>'admin' then raise insufficient_privilege; end if;
  select c.level_id,o.status into v_level_id,v_status from app.course_offerings o
  join app.courses c on c.id=o.course_id where o.id=p_offering_id for key share;
  if not found then raise no_data_found; end if;
  if v_status<>'active' then raise exception 'offering_must_be_active' using errcode='23514',constraint='offering_enrollment_active'; end if;
  insert into app.course_offering_members(offering_id,user_id,membership_role,enrollment_status,enrollment_type,enrolled_by)
  select p_offering_id,u.id,'student','active','automatic',null from app.users u
  where u.role='student' and u.status='active' and u.academic_level_id=v_level_id
  on conflict (offering_id,user_id) do nothing;
  get diagnostics v_inserted=row_count;
  insert into app.audit_logs(actor_user_id,action,target_type,target_id,metadata)
  values(p_actor_id,'offering.enrollments.sync','course_offering',p_offering_id,jsonb_build_object('insertedCount',v_inserted));
  return v_inserted;
end $$;

create function app.admin_add_offering_student(p_actor_id uuid,p_offering_id uuid,p_student_id uuid)
returns void language plpgsql security definer set search_path=app,pg_temp as $$
begin
  if p_actor_id is distinct from app.current_user_id() or app.current_user_role()<>'admin' then raise insufficient_privilege; end if;
  if not exists(select 1 from app.course_offerings where id=p_offering_id for key share) then raise no_data_found; end if;
  if not exists(select 1 from app.users where id=p_student_id and role='student' and status='active' for key share)
    then raise exception 'student_must_be_active' using errcode='23514',constraint='offering_member_active_role'; end if;
  insert into app.course_offering_members(offering_id,user_id,membership_role,enrollment_status,enrollment_type,enrolled_by)
  values(p_offering_id,p_student_id,'student','active','manual',p_actor_id)
  on conflict(offering_id,user_id) do update set enrollment_status='active',enrollment_type='manual',enrolled_by=p_actor_id,
    enrolled_at=now(),status_changed_at=now(),removed_at=null,removal_reason=null;
  insert into app.audit_logs(actor_user_id,action,target_type,target_id,metadata)
  values(p_actor_id,'offering.enrollment.add','course_offering',p_offering_id,jsonb_build_object('studentUserId',p_student_id));
end $$;

create function app.admin_set_offering_enrollment_status(
  p_actor_id uuid,p_offering_id uuid,p_student_id uuid,p_status varchar,p_reason varchar
) returns void language plpgsql security definer set search_path=app,pg_temp as $$
declare v_previous varchar;
begin
  if p_actor_id is distinct from app.current_user_id() or app.current_user_role()<>'admin' then raise insufficient_privilege; end if;
  if p_status not in ('active','withdrawn','completed','suspended') then raise check_violation; end if;
  if p_status in ('withdrawn','suspended') and char_length(trim(coalesce(p_reason,'')))<3
    then raise exception 'enrollment_reason_required' using errcode='23514',constraint='course_enrollment_reason_required'; end if;
  select enrollment_status into v_previous from app.course_offering_members
  where offering_id=p_offering_id and user_id=p_student_id and membership_role='student' for update;
  if not found then raise no_data_found; end if;
  update app.course_offering_members set enrollment_status=p_status,status_changed_at=now(),
    removed_at=case when p_status in ('withdrawn','suspended') then now() else null end,
    removal_reason=case when p_status in ('withdrawn','suspended') then left(trim(p_reason),500) else null end
  where offering_id=p_offering_id and user_id=p_student_id;
  insert into app.audit_logs(actor_user_id,action,target_type,target_id,metadata)
  values(p_actor_id,'offering.enrollment.status.update','course_offering',p_offering_id,
    jsonb_build_object('studentUserId',p_student_id,'previousStatus',v_previous,'status',p_status,'reason',p_reason));
end $$;

create function app.create_default_course_offering()
returns trigger language plpgsql security definer set search_path=app,pg_temp as $$
declare v_term_id uuid;
begin
  select id into v_term_id from app.academic_terms where code='CURRENT';
  insert into app.course_offerings(course_id,term_id,instructor_user_id,section_code,status)
  values(new.id,v_term_id,new.owner_user_id,'MAIN',case when new.is_active then 'active' else 'archived' end);
  return new;
end $$;

create function app.auto_enroll_for_offering_change()
returns trigger language plpgsql security definer set search_path=app,pg_temp as $$
begin
  if new.status='active' then
    insert into app.course_offering_members(offering_id,user_id,membership_role,enrollment_status,enrollment_type)
    select new.id,u.id,'student','active','automatic' from app.users u join app.courses c on c.id=new.course_id
    where u.role='student' and u.status='active' and u.academic_level_id=c.level_id
    on conflict(offering_id,user_id) do nothing;
  end if;
  return new;
end $$;

create function app.auto_enroll_student_in_offerings()
returns trigger language plpgsql security definer set search_path=app,pg_temp as $$
begin
  if new.role='student' and new.status='active' and new.academic_level_id is not null then
    insert into app.course_offering_members(offering_id,user_id,membership_role,enrollment_status,enrollment_type)
    select o.id,new.id,'student','active','automatic' from app.course_offerings o
    join app.courses c on c.id=o.course_id
    where o.status='active' and c.is_active and c.level_id=new.academic_level_id
    on conflict(offering_id,user_id) do nothing;
  end if;
  return new;
end $$;

create trigger courses_create_default_offering after insert on app.courses
for each row execute function app.create_default_course_offering();
create trigger offerings_auto_enroll_students after insert or update of status on app.course_offerings
for each row execute function app.auto_enroll_for_offering_change();
create trigger students_auto_enroll_offerings after insert or update of role,status,academic_level_id on app.users
for each row execute function app.auto_enroll_student_in_offerings();

-- The old membership table is no longer a source, mirror, or fallback.
drop table app.course_members;

revoke all on function app.practice_execution_bundle(uuid),app.sync_offering_students(uuid,uuid),
  app.admin_add_offering_student(uuid,uuid,uuid),app.admin_set_offering_enrollment_status(uuid,uuid,uuid,varchar,varchar),
  app.create_default_course_offering(),app.auto_enroll_for_offering_change(),app.auto_enroll_student_in_offerings()
  from public;
grant execute on function app.practice_execution_bundle(uuid),app.sync_offering_students(uuid,uuid),
  app.admin_add_offering_student(uuid,uuid,uuid),app.admin_set_offering_enrollment_status(uuid,uuid,uuid,varchar,varchar)
  to masar_api_access;

commit;
