begin;

alter table app.users add column if not exists academic_level_id uuid;

update app.users
set academic_level_id = (
  select l.id from app.academic_levels l
  order by l.created_at, l.id
  limit 1
)
where role = 'student' and academic_level_id is null;

do $$ begin
  alter table app.users add constraint users_academic_level_id_fkey
    foreign key (academic_level_id) references app.academic_levels(id) on delete restrict;
exception when duplicate_object then null;
end $$;

alter table app.users drop constraint if exists users_student_level_required;
alter table app.users add constraint users_student_level_required
  check (role <> 'student' or academic_level_id is not null);
create index if not exists users_academic_level_id_idx on app.users(academic_level_id)
  where academic_level_id is not null;

drop function if exists app.admin_create_user(uuid, text, text, text, app.app_role, text, boolean);
create function app.admin_create_user(
  p_actor_id uuid, p_email text, p_phone_e164 text, p_display_name text,
  p_role app.app_role, p_academic_level_id uuid, p_password_hash text,
  p_must_change boolean default true
)
returns uuid
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_user_id uuid;
begin
  if not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;

  if p_role = 'student' and not exists (
    select 1 from app.academic_levels l
    join app.specializations s on s.id = l.specialization_id
    join app.academic_departments d on d.id = s.department_id
    where l.id = p_academic_level_id and l.is_active and s.is_active and d.is_active
    for key share of l, s, d
  ) then
    raise exception 'student_level_must_be_active'
      using errcode = '23514', constraint = 'student_academic_level_active';
  end if;

  insert into app.users(email, phone_e164, display_name, role, academic_level_id)
  values (lower(trim(p_email))::public.citext, trim(p_phone_e164), trim(p_display_name), p_role,
          case when p_role = 'student' then p_academic_level_id else null end)
  returning id into v_user_id;
  insert into app.password_credentials(user_id, password_hash, must_change_password)
  values (v_user_id, p_password_hash, p_must_change);
  return v_user_id;
end
$$;

drop function if exists app.admin_update_user(uuid, uuid, text, text, text, app.app_role);
create function app.admin_update_user(
  p_actor_id uuid, p_target_id uuid, p_email text, p_phone_e164 text,
  p_display_name text, p_role app.app_role, p_academic_level_id uuid
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

  if p_role = 'student' and not exists (
    select 1 from app.academic_levels l
    join app.specializations s on s.id = l.specialization_id
    join app.academic_departments d on d.id = s.department_id
    where l.id = p_academic_level_id and l.is_active and s.is_active and d.is_active
    for key share of l, s, d
  ) then
    raise exception 'student_level_must_be_active'
      using errcode = '23514', constraint = 'student_academic_level_active';
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
      phone_e164 = trim(p_phone_e164), display_name = trim(p_display_name), role = p_role,
      academic_level_id = case when p_role = 'student' then p_academic_level_id else null end,
      updated_at = now(), version = version + 1
  where id = p_target_id;

  if p_role <> v_current_role then
    update app.sessions set revoked_at = coalesce(revoked_at, now()) where user_id = p_target_id;
  end if;
end
$$;

revoke all on function app.admin_create_user(uuid, text, text, text, app.app_role, uuid, text, boolean) from public;
revoke all on function app.admin_update_user(uuid, uuid, text, text, text, app.app_role, uuid) from public;
grant execute on function app.admin_create_user(uuid, text, text, text, app.app_role, uuid, text, boolean),
  app.admin_update_user(uuid, uuid, text, text, text, app.app_role, uuid) to masar_api_access;

commit;
