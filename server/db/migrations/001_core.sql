begin;

create extension if not exists pgcrypto;
create extension if not exists citext;

revoke all on schema public from public;
create schema if not exists app;
revoke all on schema app from public;

do $$ begin
  create role masar_api_access nologin;
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.app_role as enum ('admin', 'instructor', 'student');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type app.account_status as enum ('active', 'suspended', 'disabled');
exception when duplicate_object then null;
end $$;

create table if not exists app.users (
  id uuid primary key default gen_random_uuid(),
  email public.citext not null unique,
  display_name text not null check (char_length(display_name) between 2 and 120),
  role app.app_role not null,
  status app.account_status not null default 'active',
  failed_login_attempts smallint not null default 0 check (failed_login_attempts >= 0),
  locked_until timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0)
);

create table if not exists app.password_credentials (
  user_id uuid primary key references app.users(id) on delete cascade,
  password_hash text not null,
  changed_at timestamptz not null default now(),
  must_change_password boolean not null default false
);

create table if not exists app.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.users(id) on delete cascade,
  token_hash bytea not null unique,
  csrf_token_hash bytea not null,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ip_hash bytea,
  user_agent varchar(512),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create table if not exists app.courses (
  id uuid primary key default gen_random_uuid(),
  code varchar(24) not null unique check (code ~ '^[A-Z0-9_-]{2,24}$'),
  title varchar(180) not null,
  owner_user_id uuid not null references app.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.course_members (
  course_id uuid not null references app.courses(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  membership_role app.app_role not null check (membership_role in ('instructor', 'student')),
  enrolled_at timestamptz not null default now(),
  primary key (course_id, user_id)
);

create table if not exists app.assignments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references app.courses(id) on delete cascade,
  title varchar(180) not null,
  description text not null default '',
  due_at timestamptz,
  max_score numeric(7,2) not null default 10 check (max_score > 0),
  published_at timestamptz,
  created_by uuid not null references app.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.audit_logs (
  id bigint generated always as identity primary key,
  actor_user_id uuid references app.users(id) on delete set null,
  action varchar(120) not null,
  target_type varchar(80),
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  ip_hash bytea,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on app.sessions(user_id);
create index if not exists sessions_active_expiry_idx on app.sessions(expires_at) where revoked_at is null;
create index if not exists courses_owner_user_id_idx on app.courses(owner_user_id);
create index if not exists course_members_user_id_idx on app.course_members(user_id);
create index if not exists assignments_course_id_idx on app.assignments(course_id);
create index if not exists assignments_created_by_idx on app.assignments(created_by);
create index if not exists audit_logs_actor_created_idx on app.audit_logs(actor_user_id, created_at desc);
create index if not exists audit_logs_created_at_idx on app.audit_logs(created_at desc);

create or replace function app.current_user_id() returns uuid
language sql stable
as $$ select nullif(current_setting('app.user_id', true), '')::uuid $$;

create or replace function app.current_user_role() returns app.app_role
language sql stable
as $$ select nullif(current_setting('app.user_role', true), '')::app.app_role $$;

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
      where c.id = p_course_id and c.owner_user_id = app.current_user_id()
    ) then true
    when not p_write and exists (
      select 1 from app.course_members cm
      where cm.course_id = p_course_id and cm.user_id = app.current_user_id()
    ) then true
    else false
  end
$$;

alter table app.users enable row level security;
alter table app.users force row level security;
alter table app.courses enable row level security;
alter table app.courses force row level security;
alter table app.course_members enable row level security;
alter table app.course_members force row level security;
alter table app.assignments enable row level security;
alter table app.assignments force row level security;
alter table app.audit_logs enable row level security;
alter table app.audit_logs force row level security;

drop policy if exists users_select_policy on app.users;
create policy users_select_policy on app.users for select
  using (id = app.current_user_id() or app.current_user_role() = 'admin');
drop policy if exists users_admin_update_policy on app.users;
create policy users_admin_update_policy on app.users for update
  using (app.current_user_role() = 'admin') with check (app.current_user_role() = 'admin');

drop policy if exists courses_select_policy on app.courses;
create policy courses_select_policy on app.courses for select using (app.can_access_course(id, false));
drop policy if exists courses_insert_policy on app.courses;
create policy courses_insert_policy on app.courses for insert with check (
  app.current_user_role() = 'admin' or
  (app.current_user_role() = 'instructor' and owner_user_id = app.current_user_id())
);
drop policy if exists courses_update_policy on app.courses;
create policy courses_update_policy on app.courses for update
  using (app.can_access_course(id, true)) with check (app.can_access_course(id, true));

drop policy if exists course_members_select_policy on app.course_members;
create policy course_members_select_policy on app.course_members for select using (app.can_access_course(course_id, false));
drop policy if exists course_members_write_policy on app.course_members;
create policy course_members_write_policy on app.course_members for all
  using (app.can_access_course(course_id, true)) with check (app.can_access_course(course_id, true));

drop policy if exists assignments_select_policy on app.assignments;
create policy assignments_select_policy on app.assignments for select using (
  app.can_access_course(course_id, false) and
  (published_at is not null or app.can_access_course(course_id, true))
);
drop policy if exists assignments_write_policy on app.assignments;
create policy assignments_write_policy on app.assignments for all
  using (app.can_access_course(course_id, true)) with check (
    app.can_access_course(course_id, true) and created_by = app.current_user_id()
  );

drop policy if exists audit_admin_select_policy on app.audit_logs;
create policy audit_admin_select_policy on app.audit_logs for select using (app.current_user_role() = 'admin');

create or replace function app.auth_login_candidate(p_email text)
returns table (
  user_id uuid, email public.citext, display_name text, role app.app_role,
  status app.account_status, password_hash text, failed_login_attempts smallint,
  locked_until timestamptz, must_change_password boolean
)
language sql stable security definer
set search_path = app, pg_temp
as $$
  select u.id, u.email, u.display_name, u.role, u.status, pc.password_hash,
         u.failed_login_attempts, u.locked_until, pc.must_change_password
  from app.users u
  join app.password_credentials pc on pc.user_id = u.id
  where u.email = lower(trim(p_email))::public.citext
  limit 1
$$;

create or replace function app.auth_record_failure(p_user_id uuid)
returns void
language plpgsql security definer
set search_path = app, pg_temp
as $$
begin
  update app.users
  set failed_login_attempts = least(failed_login_attempts + 1, 32767),
      locked_until = case when failed_login_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end,
      updated_at = now(), version = version + 1
  where id = p_user_id;
end
$$;

create or replace function app.auth_register_session(
  p_user_id uuid, p_token_hash bytea, p_csrf_hash bytea, p_expires_at timestamptz,
  p_ip_hash bytea, p_user_agent text
)
returns uuid
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_session_id uuid;
begin
  if not exists (select 1 from app.users where id = p_user_id and status = 'active') then
    raise exception 'account_unavailable';
  end if;
  insert into app.sessions(user_id, token_hash, csrf_token_hash, expires_at, ip_hash, user_agent)
  values (p_user_id, p_token_hash, p_csrf_hash, p_expires_at, p_ip_hash, left(p_user_agent, 512))
  returning id into v_session_id;
  update app.users set failed_login_attempts = 0, locked_until = null, last_login_at = now(), updated_at = now()
  where id = p_user_id;
  return v_session_id;
end
$$;

create or replace function app.auth_get_session(p_token_hash bytea)
returns table (
  session_id uuid, user_id uuid, email public.citext, display_name text, role app.app_role,
  status app.account_status, csrf_token_hash bytea, expires_at timestamptz,
  must_change_password boolean
)
language plpgsql security definer
set search_path = app, pg_temp
as $$
begin
  update app.sessions s set last_seen_at = now()
  where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
    and s.last_seen_at < now() - interval '5 minutes';
  return query
    select s.id, u.id, u.email, u.display_name, u.role, u.status,
           s.csrf_token_hash, s.expires_at, pc.must_change_password
    from app.sessions s
    join app.users u on u.id = s.user_id
    join app.password_credentials pc on pc.user_id = u.id
    where s.token_hash = p_token_hash and s.revoked_at is null and s.expires_at > now()
      and u.status = 'active'
    limit 1;
end
$$;

create or replace function app.auth_revoke_session(p_token_hash bytea)
returns void language sql security definer set search_path = app, pg_temp
as $$ update app.sessions set revoked_at = coalesce(revoked_at, now()) where token_hash = p_token_hash $$;

create or replace function app.auth_update_password(p_actor_id uuid, p_target_id uuid, p_password_hash text)
returns void
language plpgsql security definer
set search_path = app, pg_temp
as $$
begin
  if p_actor_id <> p_target_id and not exists (
    select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active'
  ) then raise insufficient_privilege; end if;
  update app.password_credentials
  set password_hash = p_password_hash, changed_at = now(), must_change_password = false
  where user_id = p_target_id;
  update app.sessions set revoked_at = coalesce(revoked_at, now()) where user_id = p_target_id;
  update app.users set version = version + 1, updated_at = now() where id = p_target_id;
end
$$;

create or replace function app.admin_create_user(
  p_actor_id uuid, p_email text, p_display_name text, p_role app.app_role,
  p_password_hash text, p_must_change boolean default true
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
  insert into app.users(email, display_name, role)
  values (lower(trim(p_email))::public.citext, trim(p_display_name), p_role)
  returning id into v_user_id;
  insert into app.password_credentials(user_id, password_hash, must_change_password)
  values (v_user_id, p_password_hash, p_must_change);
  return v_user_id;
end
$$;

create or replace function app.write_audit(
  p_actor_id uuid, p_action text, p_target_type text, p_target_id uuid,
  p_metadata jsonb, p_ip_hash bytea
)
returns void
language sql security definer
set search_path = app, pg_temp
as $$
  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata, ip_hash)
  values (p_actor_id, left(p_action, 120), left(p_target_type, 80), p_target_id, coalesce(p_metadata, '{}'::jsonb), p_ip_hash)
$$;

revoke all on all functions in schema app from public;
grant usage on schema app to masar_api_access;
grant select, insert, update on app.users, app.courses, app.course_members, app.assignments to masar_api_access;
grant select on app.audit_logs to masar_api_access;
grant execute on function app.current_user_id(), app.current_user_role(), app.can_access_course(uuid, boolean) to masar_api_access;
grant execute on function app.auth_login_candidate(text), app.auth_record_failure(uuid), app.auth_register_session(uuid, bytea, bytea, timestamptz, bytea, text), app.auth_get_session(bytea), app.auth_revoke_session(bytea), app.auth_update_password(uuid, uuid, text), app.admin_create_user(uuid, text, text, app.app_role, text, boolean), app.write_audit(uuid, text, text, uuid, jsonb, bytea) to masar_api_access;

commit;
