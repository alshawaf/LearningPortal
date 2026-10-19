begin;

create or replace function app.admin_create_department(
  p_actor_id uuid, p_code text, p_name text
)
returns uuid
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_department_id uuid;
begin
  if not exists (
    select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active'
  ) then raise insufficient_privilege; end if;

  insert into app.academic_departments(code, name)
  values (upper(trim(p_code)), trim(p_name))
  returning id into v_department_id;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'academic.department.create', 'academic_department', v_department_id,
          jsonb_build_object('code', upper(trim(p_code))));
  return v_department_id;
end
$$;

create or replace function app.admin_create_specialization(
  p_actor_id uuid, p_department_id uuid, p_code text, p_name text
)
returns uuid
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_specialization_id uuid;
begin
  if not exists (
    select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active'
  ) then raise insufficient_privilege; end if;

  if not exists (
    select 1 from app.academic_departments
    where id = p_department_id and is_active for key share
  ) then
    raise exception 'academic_department_must_be_active'
      using errcode = '23514', constraint = 'academic_parent_active';
  end if;

  insert into app.specializations(department_id, code, name)
  values (p_department_id, upper(trim(p_code)), trim(p_name))
  returning id into v_specialization_id;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'academic.specialization.create', 'specialization', v_specialization_id,
          jsonb_build_object('departmentId', p_department_id, 'code', upper(trim(p_code))));
  return v_specialization_id;
end
$$;

create or replace function app.admin_create_academic_level(
  p_actor_id uuid, p_specialization_id uuid, p_level_number smallint, p_name text
)
returns uuid
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_level_id uuid;
begin
  if not exists (
    select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active'
  ) then raise insufficient_privilege; end if;

  if not exists (
    select 1
    from app.specializations s
    join app.academic_departments d on d.id = s.department_id
    where s.id = p_specialization_id and s.is_active and d.is_active
    for key share of s, d
  ) then
    raise exception 'academic_specialization_must_be_active'
      using errcode = '23514', constraint = 'academic_parent_active';
  end if;

  insert into app.academic_levels(specialization_id, level_number, name)
  values (p_specialization_id, p_level_number, trim(p_name))
  returning id into v_level_id;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'academic.level.create', 'academic_level', v_level_id,
          jsonb_build_object('specializationId', p_specialization_id, 'levelNumber', p_level_number));
  return v_level_id;
end
$$;

revoke all on function app.admin_create_department(uuid, text, text) from public;
revoke all on function app.admin_create_specialization(uuid, uuid, text, text) from public;
revoke all on function app.admin_create_academic_level(uuid, uuid, smallint, text) from public;
grant execute on function app.admin_create_department(uuid, text, text) to masar_api_access;
grant execute on function app.admin_create_specialization(uuid, uuid, text, text) to masar_api_access;
grant execute on function app.admin_create_academic_level(uuid, uuid, smallint, text) to masar_api_access;

commit;
