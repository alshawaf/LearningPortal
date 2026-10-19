begin;

create or replace function app.admin_update_user(
  p_actor_id uuid, p_target_id uuid, p_email text, p_phone_e164 text,
  p_display_name text, p_role app.app_role
)
returns void
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare
  v_current_role app.app_role;
  v_current_status app.account_status;
begin
  if not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;

  select role, status into v_current_role, v_current_status
  from app.users where id = p_target_id for update;
  if not found then raise no_data_found; end if;

  if p_actor_id = p_target_id and p_role <> v_current_role then
    raise exception 'admin_self_protection'
      using errcode = '23514', constraint = 'admin_self_protection';
  end if;

  if v_current_role = 'admin' and v_current_status = 'active' and p_role <> 'admin' then
    perform 1 from app.users where role = 'admin' and status = 'active' for update;
    if (select count(*) from app.users where role = 'admin' and status = 'active') <= 1 then
      raise exception 'last_active_admin'
        using errcode = '23514', constraint = 'users_last_active_admin';
    end if;
  end if;

  update app.users
  set email = lower(trim(p_email))::public.citext,
      phone_e164 = trim(p_phone_e164),
      display_name = trim(p_display_name),
      role = p_role,
      updated_at = now(), version = version + 1
  where id = p_target_id;

  if p_role <> v_current_role then
    update app.sessions set revoked_at = coalesce(revoked_at, now())
    where user_id = p_target_id;
  end if;
end
$$;

create or replace function app.admin_set_user_status(
  p_actor_id uuid, p_target_id uuid, p_status app.account_status
)
returns void
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare
  v_current_role app.app_role;
  v_current_status app.account_status;
begin
  if not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;

  select role, status into v_current_role, v_current_status
  from app.users where id = p_target_id for update;
  if not found then raise no_data_found; end if;

  if p_actor_id = p_target_id and p_status <> v_current_status then
    raise exception 'admin_self_protection'
      using errcode = '23514', constraint = 'admin_self_protection';
  end if;

  if v_current_role = 'admin' and v_current_status = 'active' and p_status <> 'active' then
    perform 1 from app.users where role = 'admin' and status = 'active' for update;
    if (select count(*) from app.users where role = 'admin' and status = 'active') <= 1 then
      raise exception 'last_active_admin'
        using errcode = '23514', constraint = 'users_last_active_admin';
    end if;
  end if;

  update app.users
  set status = p_status,
      failed_login_attempts = case when p_status = 'active' then 0 else failed_login_attempts end,
      locked_until = case when p_status = 'active' then null else locked_until end,
      updated_at = now(), version = version + 1
  where id = p_target_id;

  if p_status <> 'active' then
    update app.sessions set revoked_at = coalesce(revoked_at, now())
    where user_id = p_target_id;
  end if;
end
$$;

revoke all on function app.admin_update_user(uuid, uuid, text, text, text, app.app_role) from public;
revoke all on function app.admin_set_user_status(uuid, uuid, app.account_status) from public;
grant execute on function app.admin_update_user(uuid, uuid, text, text, text, app.app_role),
  app.admin_set_user_status(uuid, uuid, app.account_status) to masar_api_access;

commit;
