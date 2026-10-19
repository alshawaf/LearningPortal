begin;

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
    when not p_write and exists (
      select 1
      from app.course_members cm
      join app.courses c on c.id = cm.course_id
      where cm.course_id = p_course_id and cm.user_id = app.current_user_id() and c.is_active
    ) then true
    else false
  end
$$;

create or replace function app.admin_update_course(
  p_actor_id uuid, p_course_id uuid, p_owner_user_id uuid, p_level_id uuid,
  p_code text, p_title text
)
returns void
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_previous jsonb;
begin
  if p_actor_id is distinct from app.current_user_id()
     or app.current_user_role() <> 'admin'
     or not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;

  if not exists (
    select 1 from app.users
    where id = p_owner_user_id and role = 'instructor' and status = 'active'
    for key share
  ) then
    raise exception 'course_owner_must_be_active_instructor'
      using errcode = '23514', constraint = 'course_owner_active_instructor';
  end if;

  if not exists (
    select 1
    from app.academic_levels l
    join app.specializations s on s.id = l.specialization_id
    join app.academic_departments d on d.id = s.department_id
    where l.id = p_level_id and l.is_active and s.is_active and d.is_active
    for key share of l, s, d
  ) then
    raise exception 'course_level_must_be_active'
      using errcode = '23514', constraint = 'course_level_active_hierarchy';
  end if;

  select jsonb_build_object(
    'code', code, 'title', title, 'ownerUserId', owner_user_id,
    'levelId', level_id, 'isActive', is_active
  ) into v_previous
  from app.courses where id = p_course_id for update;
  if not found then raise no_data_found; end if;

  update app.courses
  set code = upper(trim(p_code)), title = trim(p_title), owner_user_id = p_owner_user_id,
      level_id = p_level_id, updated_at = now()
  where id = p_course_id;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'course.update', 'course', p_course_id,
          jsonb_build_object('previous', v_previous, 'code', upper(trim(p_code)),
            'title', trim(p_title), 'ownerUserId', p_owner_user_id, 'levelId', p_level_id));
end
$$;

create or replace function app.admin_set_course_status(
  p_actor_id uuid, p_course_id uuid, p_is_active boolean
)
returns void
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_previous boolean;
begin
  if p_actor_id is distinct from app.current_user_id()
     or app.current_user_role() <> 'admin'
     or not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;

  select is_active into v_previous from app.courses where id = p_course_id for update;
  if not found then raise no_data_found; end if;

  update app.courses set is_active = p_is_active, updated_at = now() where id = p_course_id;
  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'course.status.update', 'course', p_course_id,
          jsonb_build_object('previousIsActive', v_previous, 'isActive', p_is_active));
end
$$;

revoke all on function app.admin_update_course(uuid, uuid, uuid, uuid, text, text) from public;
revoke all on function app.admin_set_course_status(uuid, uuid, boolean) from public;
grant execute on function app.admin_update_course(uuid, uuid, uuid, uuid, text, text) to masar_api_access;
grant execute on function app.admin_set_course_status(uuid, uuid, boolean) to masar_api_access;

commit;
