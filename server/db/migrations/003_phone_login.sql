begin;

alter table app.users add column if not exists phone_e164 varchar(16);
alter table app.users drop constraint if exists users_phone_e164_format;
alter table app.users add constraint users_phone_e164_format
  check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$');
create unique index if not exists users_phone_e164_unique
  on app.users(phone_e164) where phone_e164 is not null;

drop function if exists app.auth_login_candidate(text);
create function app.auth_login_candidate(p_identifier text)
returns table (
  user_id uuid, email public.citext, phone_e164 varchar, display_name text, role app.app_role,
  status app.account_status, password_hash text, failed_login_attempts smallint,
  locked_until timestamptz, must_change_password boolean
)
language plpgsql stable security definer
set search_path = app, pg_temp
as $$
begin
  if position('@' in p_identifier) > 0 then
    return query
      select u.id, u.email, u.phone_e164, u.display_name, u.role, u.status, pc.password_hash,
             u.failed_login_attempts, u.locked_until, pc.must_change_password
      from app.users u join app.password_credentials pc on pc.user_id = u.id
      where u.email = lower(trim(p_identifier))::public.citext limit 1;
  else
    return query
      select u.id, u.email, u.phone_e164, u.display_name, u.role, u.status, pc.password_hash,
             u.failed_login_attempts, u.locked_until, pc.must_change_password
      from app.users u join app.password_credentials pc on pc.user_id = u.id
      where u.phone_e164 = trim(p_identifier) limit 1;
  end if;
end
$$;

drop function if exists app.auth_get_session(bytea);
create function app.auth_get_session(p_token_hash bytea)
returns table (
  session_id uuid, user_id uuid, email public.citext, phone_e164 varchar,
  display_name text, role app.app_role, status app.account_status,
  csrf_token_hash bytea, expires_at timestamptz, must_change_password boolean
)
language plpgsql security definer
set search_path = app, pg_temp
as $$
begin
  update app.sessions s set last_seen_at = now()
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
    and s.last_seen_at < now() - interval '5 minutes';
  return query
    select s.id, u.id, u.email, u.phone_e164, u.display_name, u.role, u.status,
           s.csrf_token_hash, s.expires_at, pc.must_change_password
    from app.sessions s
    join app.users u on u.id = s.user_id
    join app.password_credentials pc on pc.user_id = u.id
    where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
      and u.status = 'active'
    limit 1;
end
$$;

drop function if exists app.admin_create_user(uuid, text, text, app.app_role, text, boolean);
create function app.admin_create_user(
  p_actor_id uuid, p_email text, p_phone_e164 text, p_display_name text,
  p_role app.app_role, p_password_hash text, p_must_change boolean default true
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
  insert into app.users(email, phone_e164, display_name, role)
  values (lower(trim(p_email))::public.citext, trim(p_phone_e164), trim(p_display_name), p_role)
  returning id into v_user_id;
  insert into app.password_credentials(user_id, password_hash, must_change_password)
  values (v_user_id, p_password_hash, p_must_change);
  return v_user_id;
end
$$;

revoke all on function app.auth_login_candidate(text) from public;
revoke all on function app.auth_get_session(bytea) from public;
revoke all on function app.admin_create_user(uuid, text, text, text, app.app_role, text, boolean) from public;
grant execute on function app.auth_login_candidate(text), app.auth_get_session(bytea),
  app.admin_create_user(uuid, text, text, text, app.app_role, text, boolean) to masar_api_access;

commit;
