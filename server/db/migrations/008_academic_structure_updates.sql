begin;

create or replace function app.admin_update_department(
  p_actor_id uuid, p_department_id uuid, p_code text, p_name text
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

  select jsonb_build_object('code', code, 'name', name) into v_previous
  from app.academic_departments where id = p_department_id for update;
  if not found then raise no_data_found; end if;

  update app.academic_departments
  set code = upper(trim(p_code)), name = trim(p_name), updated_at = now()
  where id = p_department_id;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'academic.department.update', 'academic_department', p_department_id,
          jsonb_build_object('previous', v_previous, 'code', upper(trim(p_code)), 'name', trim(p_name)));
end
$$;

create or replace function app.admin_update_specialization(
  p_actor_id uuid, p_specialization_id uuid, p_code text, p_name text
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

  select jsonb_build_object('code', code, 'name', name) into v_previous
  from app.specializations where id = p_specialization_id for update;
  if not found then raise no_data_found; end if;

  update app.specializations
  set code = upper(trim(p_code)), name = trim(p_name), updated_at = now()
  where id = p_specialization_id;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'academic.specialization.update', 'specialization', p_specialization_id,
          jsonb_build_object('previous', v_previous, 'code', upper(trim(p_code)), 'name', trim(p_name)));
end
$$;

create or replace function app.admin_update_academic_level(
  p_actor_id uuid, p_level_id uuid, p_level_number smallint, p_name text
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

  select jsonb_build_object('number', level_number, 'name', name) into v_previous
  from app.academic_levels where id = p_level_id for update;
  if not found then raise no_data_found; end if;

  update app.academic_levels
  set level_number = p_level_number, name = trim(p_name), updated_at = now()
  where id = p_level_id;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'academic.level.update', 'academic_level', p_level_id,
          jsonb_build_object('previous', v_previous, 'number', p_level_number, 'name', trim(p_name)));
end
$$;

revoke all on function app.admin_update_department(uuid, uuid, text, text) from public;
revoke all on function app.admin_update_specialization(uuid, uuid, text, text) from public;
revoke all on function app.admin_update_academic_level(uuid, uuid, smallint, text) from public;
grant execute on function app.admin_update_department(uuid, uuid, text, text) to masar_api_access;
grant execute on function app.admin_update_specialization(uuid, uuid, text, text) to masar_api_access;
grant execute on function app.admin_update_academic_level(uuid, uuid, smallint, text) to masar_api_access;

commit;
