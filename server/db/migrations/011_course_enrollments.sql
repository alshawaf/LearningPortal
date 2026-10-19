begin;

alter table app.course_members
  add column if not exists enrollment_status varchar(20) not null default 'active',
  add column if not exists enrollment_type varchar(20) not null default 'manual',
  add column if not exists enrolled_by uuid references app.users(id) on delete set null,
  add column if not exists status_changed_at timestamptz not null default now(),
  add column if not exists removed_at timestamptz,
  add column if not exists removal_reason varchar(500);

alter table app.course_members drop constraint if exists course_members_enrollment_status_check;
alter table app.course_members add constraint course_members_enrollment_status_check
  check (enrollment_status in ('active', 'withdrawn', 'completed', 'suspended'));
alter table app.course_members drop constraint if exists course_members_enrollment_type_check;
alter table app.course_members add constraint course_members_enrollment_type_check
  check (enrollment_type in ('automatic', 'manual'));
alter table app.course_members drop constraint if exists course_members_removal_consistency_check;
alter table app.course_members add constraint course_members_removal_consistency_check check (
  (enrollment_status in ('withdrawn', 'suspended') and removed_at is not null)
  or (enrollment_status in ('active', 'completed') and removed_at is null)
);

create index if not exists course_members_course_status_idx
  on app.course_members(course_id, enrollment_status, user_id)
  where membership_role = 'student';
create index if not exists course_members_user_active_idx
  on app.course_members(user_id, course_id)
  where membership_role = 'student' and enrollment_status = 'active';

create or replace function app.can_access_course(p_course_id uuid, p_write boolean default false)
returns boolean
language sql stable security definer
set search_path = app, pg_temp
as $$
  select case
    when app.current_user_id() is null then false
    when app.current_user_role() = 'admin' then true
    when exists (
      select 1 from app.courses c
      where c.id = p_course_id and c.is_active and c.owner_user_id = app.current_user_id()
    ) then true
    when not p_write and app.current_user_role() = 'student' and exists (
      select 1
      from app.course_members cm
      join app.courses c on c.id = cm.course_id
      where cm.course_id = p_course_id
        and cm.user_id = app.current_user_id()
        and cm.membership_role = 'student'
        and cm.enrollment_status = 'active'
        and c.is_active
    ) then true
    else false
  end
$$;

drop policy if exists course_members_write_policy on app.course_members;
create policy course_members_write_policy on app.course_members for all
  using (app.current_user_role() = 'admin')
  with check (app.current_user_role() = 'admin');

drop policy if exists users_select_policy on app.users;
create policy users_select_policy on app.users for select using (
  id = app.current_user_id()
  or app.current_user_role() = 'admin'
  or (
    app.current_user_role() = 'instructor'
    and exists (
      select 1 from app.course_members cm
      where cm.user_id = users.id
        and cm.membership_role = 'student'
        and cm.enrollment_status = 'active'
        and app.can_access_course(cm.course_id, true)
    )
  )
  or exists (
    select 1 from app.courses c
    where c.owner_user_id = users.id and app.can_access_course(c.id, false)
  )
);

create or replace function app.sync_course_students(p_actor_id uuid, p_course_id uuid)
returns integer
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare
  v_level_id uuid;
  v_is_active boolean;
  v_inserted integer := 0;
begin
  if p_actor_id is distinct from app.current_user_id()
     or app.current_user_role() <> 'admin'
     or not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;

  select level_id, is_active into v_level_id, v_is_active
  from app.courses where id = p_course_id for key share;
  if not found then raise no_data_found; end if;
  if not v_is_active then
    raise exception 'course_must_be_active'
      using errcode = '23514', constraint = 'course_enrollment_active_course';
  end if;

  insert into app.course_members(
    course_id, user_id, membership_role, enrollment_status, enrollment_type,
    enrolled_by, enrolled_at, status_changed_at, removed_at, removal_reason
  )
  select p_course_id, u.id, 'student', 'active', 'automatic', null, now(), now(), null, null
  from app.users u
  where u.role = 'student' and u.status = 'active' and u.academic_level_id = v_level_id
  on conflict (course_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'course.enrollments.sync', 'course', p_course_id,
          jsonb_build_object('insertedCount', v_inserted));
  return v_inserted;
end
$$;

create or replace function app.admin_add_course_student(
  p_actor_id uuid, p_course_id uuid, p_student_id uuid
)
returns void
language plpgsql security definer
set search_path = app, pg_temp
as $$
begin
  if p_actor_id is distinct from app.current_user_id()
     or app.current_user_role() <> 'admin'
     or not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;
  if not exists (select 1 from app.courses where id = p_course_id for key share) then raise no_data_found; end if;
  if not exists (
    select 1 from app.users
    where id = p_student_id and role = 'student' and status = 'active'
    for key share
  ) then
    raise exception 'student_must_be_active'
      using errcode = '23514', constraint = 'course_enrollment_active_student';
  end if;

  insert into app.course_members(
    course_id, user_id, membership_role, enrollment_status, enrollment_type,
    enrolled_by, enrolled_at, status_changed_at, removed_at, removal_reason
  ) values (p_course_id, p_student_id, 'student', 'active', 'manual', p_actor_id, now(), now(), null, null)
  on conflict (course_id, user_id) do update
  set membership_role = 'student', enrollment_status = 'active', enrollment_type = 'manual',
      enrolled_by = p_actor_id, enrolled_at = now(), status_changed_at = now(),
      removed_at = null, removal_reason = null;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'course.enrollment.add', 'course', p_course_id,
          jsonb_build_object('studentUserId', p_student_id, 'enrollmentType', 'manual'));
end
$$;

create or replace function app.admin_set_course_enrollment_status(
  p_actor_id uuid, p_course_id uuid, p_student_id uuid,
  p_status varchar, p_reason varchar
)
returns void
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_previous varchar;
begin
  if p_actor_id is distinct from app.current_user_id()
     or app.current_user_role() <> 'admin'
     or not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;
  if p_status not in ('active', 'withdrawn', 'completed', 'suspended') then
    raise check_violation;
  end if;
  if p_status in ('withdrawn', 'suspended') and char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'enrollment_reason_required'
      using errcode = '23514', constraint = 'course_enrollment_reason_required';
  end if;

  select enrollment_status into v_previous
  from app.course_members
  where course_id = p_course_id and user_id = p_student_id and membership_role = 'student'
  for update;
  if not found then raise no_data_found; end if;

  update app.course_members
  set enrollment_status = p_status,
      status_changed_at = now(),
      removed_at = case when p_status in ('withdrawn', 'suspended') then now() else null end,
      removal_reason = case when p_status in ('withdrawn', 'suspended') then left(trim(p_reason), 500) else null end
  where course_id = p_course_id and user_id = p_student_id;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'course.enrollment.status.update', 'course', p_course_id,
          jsonb_build_object('studentUserId', p_student_id, 'previousStatus', v_previous,
            'status', p_status, 'reason', case when p_reason is null then null else left(trim(p_reason), 500) end));
end
$$;

create or replace function app.auto_enroll_for_course_change()
returns trigger
language plpgsql security definer
set search_path = app, pg_temp
as $$
begin
  if new.is_active and (
    tg_op = 'INSERT'
    or (tg_op = 'UPDATE' and (old.is_active is distinct from new.is_active or old.level_id is distinct from new.level_id))
  ) then
    insert into app.course_members(
      course_id, user_id, membership_role, enrollment_status, enrollment_type,
      enrolled_by, enrolled_at, status_changed_at, removed_at, removal_reason
    )
    select new.id, u.id, 'student', 'active', 'automatic', null, now(), now(), null, null
    from app.users u
    where u.role = 'student' and u.status = 'active' and u.academic_level_id = new.level_id
    on conflict (course_id, user_id) do nothing;
  end if;
  return new;
end
$$;

create or replace function app.auto_enroll_for_student_change()
returns trigger
language plpgsql security definer
set search_path = app, pg_temp
as $$
begin
  if new.role = 'student' and new.status = 'active' and new.academic_level_id is not null then
    insert into app.course_members(
      course_id, user_id, membership_role, enrollment_status, enrollment_type,
      enrolled_by, enrolled_at, status_changed_at, removed_at, removal_reason
    )
    select c.id, new.id, 'student', 'active', 'automatic', null, now(), now(), null, null
    from app.courses c
    where c.is_active and c.level_id = new.academic_level_id
    on conflict (course_id, user_id) do nothing;
  end if;
  return new;
end
$$;

drop trigger if exists courses_auto_enroll_students on app.courses;
create trigger courses_auto_enroll_students
after insert or update of level_id, is_active on app.courses
for each row execute function app.auto_enroll_for_course_change();

drop trigger if exists students_auto_enroll_courses on app.users;
create trigger students_auto_enroll_courses
after insert or update of role, status, academic_level_id on app.users
for each row execute function app.auto_enroll_for_student_change();

-- Bring current active students into their matching active courses once.
insert into app.course_members(
  course_id, user_id, membership_role, enrollment_status, enrollment_type,
  enrolled_by, enrolled_at, status_changed_at, removed_at, removal_reason
)
select c.id, u.id, 'student', 'active', 'automatic', null, now(), now(), null, null
from app.courses c
join app.users u on u.academic_level_id = c.level_id
where c.is_active and u.role = 'student' and u.status = 'active'
on conflict (course_id, user_id) do nothing;

revoke all on function app.sync_course_students(uuid, uuid) from public;
revoke all on function app.admin_add_course_student(uuid, uuid, uuid) from public;
revoke all on function app.admin_set_course_enrollment_status(uuid, uuid, uuid, varchar, varchar) from public;
revoke all on function app.auto_enroll_for_course_change() from public;
revoke all on function app.auto_enroll_for_student_change() from public;
grant execute on function app.sync_course_students(uuid, uuid),
  app.admin_add_course_student(uuid, uuid, uuid),
  app.admin_set_course_enrollment_status(uuid, uuid, uuid, varchar, varchar)
  to masar_api_access;

commit;
