begin;

alter table app.users add column if not exists student_number varchar(32);
create unique index if not exists users_student_number_unique
  on app.users(student_number) where student_number is not null;

create table if not exists app.student_registration_requests (
  id uuid primary key default gen_random_uuid(),
  email public.citext not null,
  phone_e164 varchar(16) not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  display_name varchar(120) not null check (char_length(trim(display_name)) between 2 and 120),
  student_number varchar(32),
  academic_level_id uuid not null references app.academic_levels(id) on delete restrict,
  status varchar(24) not null default 'pending'
    check (status in ('pending', 'changes_requested', 'approved', 'rejected', 'cancelled', 'expired')),
  tracking_token_hash bytea not null unique,
  submitted_ip_hash bytea,
  decision_reason varchar(500),
  reviewed_by uuid references app.users(id) on delete set null,
  reviewed_at timestamptz,
  approved_user_id uuid unique references app.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  check (student_number is null or student_number ~ '^[A-Za-z0-9_-]{3,32}$'),
  check ((status = 'approved') = (approved_user_id is not null)),
  check (status not in ('rejected', 'changes_requested') or char_length(trim(coalesce(decision_reason, ''))) >= 3)
);

create table if not exists app.student_registration_credentials (
  request_id uuid primary key references app.student_registration_requests(id) on delete cascade,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists registration_requests_open_email_unique
  on app.student_registration_requests(email)
  where status in ('pending', 'changes_requested');
create unique index if not exists registration_requests_open_phone_unique
  on app.student_registration_requests(phone_e164)
  where status in ('pending', 'changes_requested');
create unique index if not exists registration_requests_open_student_number_unique
  on app.student_registration_requests(student_number)
  where student_number is not null and status in ('pending', 'changes_requested');
create index if not exists registration_requests_status_created_idx
  on app.student_registration_requests(status, created_at desc);
create index if not exists registration_requests_level_idx
  on app.student_registration_requests(academic_level_id, status);

alter table app.student_registration_requests enable row level security;
alter table app.student_registration_requests force row level security;
alter table app.student_registration_credentials enable row level security;
alter table app.student_registration_credentials force row level security;

drop policy if exists registration_requests_admin_select_policy on app.student_registration_requests;
create policy registration_requests_admin_select_policy on app.student_registration_requests for select
  using (app.current_user_role() = 'admin');

create or replace function app.public_registration_options()
returns table (
  department_id uuid, department_code varchar, department_name varchar,
  specialization_id uuid, specialization_code varchar, specialization_name varchar,
  level_id uuid, level_number smallint, level_name varchar
)
language sql stable security definer
set search_path = app, pg_temp
as $$
  select d.id, d.code, d.name, s.id, s.code, s.name, l.id, l.level_number, l.name
  from app.academic_departments d
  join app.specializations s on s.department_id = d.id and s.is_active
  join app.academic_levels l on l.specialization_id = s.id and l.is_active
  where d.is_active
  order by d.name, s.name, l.level_number
$$;

create or replace function app.create_student_registration(
  p_email text, p_phone_e164 text, p_display_name text, p_student_number text,
  p_academic_level_id uuid, p_password_hash text, p_tracking_token_hash bytea,
  p_ip_hash bytea
)
returns uuid
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_request_id uuid;
begin
  if not exists (
    select 1 from app.academic_levels l
    join app.specializations s on s.id = l.specialization_id
    join app.academic_departments d on d.id = s.department_id
    where l.id = p_academic_level_id and l.is_active and s.is_active and d.is_active
  ) then
    raise exception 'registration_level_inactive'
      using errcode = '23514', constraint = 'registration_level_active';
  end if;

  if exists (
    select 1 from app.users u
    where u.email = lower(trim(p_email))::public.citext
       or u.phone_e164 = trim(p_phone_e164)
       or (nullif(trim(p_student_number), '') is not null and u.student_number = trim(p_student_number))
  ) then
    raise unique_violation using constraint = 'registration_identity_conflict';
  end if;

  insert into app.student_registration_requests(
    email, phone_e164, display_name, student_number, academic_level_id,
    tracking_token_hash, submitted_ip_hash
  ) values (
    lower(trim(p_email))::public.citext, trim(p_phone_e164), trim(p_display_name),
    nullif(upper(trim(p_student_number)), ''), p_academic_level_id,
    p_tracking_token_hash, p_ip_hash
  ) returning id into v_request_id;

  insert into app.student_registration_credentials(request_id, password_hash)
  values (v_request_id, p_password_hash);

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata, ip_hash)
  values (null, 'registration.submitted', 'student_registration', v_request_id,
          jsonb_build_object('status', 'pending'), p_ip_hash);
  return v_request_id;
end
$$;

create or replace function app.student_registration_status(p_tracking_token_hash bytea)
returns table (
  request_id uuid, email public.citext, phone_e164 varchar, display_name varchar,
  student_number varchar, status varchar, decision_reason varchar,
  department_name varchar, specialization_name varchar, level_name varchar,
  created_at timestamptz, updated_at timestamptz
)
language sql stable security definer
set search_path = app, pg_temp
as $$
  select r.id, r.email, r.phone_e164, r.display_name, r.student_number,
         r.status, r.decision_reason, d.name, s.name, l.name, r.created_at, r.updated_at
  from app.student_registration_requests r
  join app.academic_levels l on l.id = r.academic_level_id
  join app.specializations s on s.id = l.specialization_id
  join app.academic_departments d on d.id = s.department_id
  where r.tracking_token_hash = p_tracking_token_hash
  limit 1
$$;

create or replace function app.admin_update_student_registration(
  p_actor_id uuid, p_request_id uuid, p_email text, p_phone_e164 text,
  p_display_name text, p_student_number text, p_academic_level_id uuid
)
returns void
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_status varchar;
begin
  if p_actor_id is distinct from app.current_user_id()
     or app.current_user_role() <> 'admin'
     or not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;
  select status into v_status from app.student_registration_requests where id = p_request_id for update;
  if not found then raise no_data_found; end if;
  if v_status not in ('pending', 'changes_requested') then
    raise exception 'registration_not_reviewable'
      using errcode = '23514', constraint = 'registration_request_reviewable';
  end if;
  if not exists (
    select 1 from app.academic_levels l
    join app.specializations s on s.id = l.specialization_id
    join app.academic_departments d on d.id = s.department_id
    where l.id = p_academic_level_id and l.is_active and s.is_active and d.is_active
  ) then
    raise exception 'registration_level_inactive'
      using errcode = '23514', constraint = 'registration_level_active';
  end if;
  if exists (
    select 1 from app.users u
    where u.email = lower(trim(p_email))::public.citext
       or u.phone_e164 = trim(p_phone_e164)
       or (nullif(trim(p_student_number), '') is not null and u.student_number = upper(trim(p_student_number)))
  ) then
    raise unique_violation using constraint = 'registration_identity_conflict';
  end if;

  update app.student_registration_requests
  set email = lower(trim(p_email))::public.citext,
      phone_e164 = trim(p_phone_e164), display_name = trim(p_display_name),
      student_number = nullif(upper(trim(p_student_number)), ''),
      academic_level_id = p_academic_level_id, updated_at = now(), version = version + 1
  where id = p_request_id;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'registration.updated_by_admin', 'student_registration', p_request_id,
          jsonb_build_object('status', v_status));
end
$$;

create or replace function app.admin_decide_student_registration(
  p_actor_id uuid, p_request_id uuid, p_decision varchar, p_reason text
)
returns uuid
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare
  v_request app.student_registration_requests%rowtype;
  v_password_hash text;
  v_user_id uuid;
begin
  if p_actor_id is distinct from app.current_user_id()
     or app.current_user_role() <> 'admin'
     or not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;
  if p_decision not in ('approved', 'rejected', 'changes_requested') then raise check_violation; end if;
  if p_decision in ('rejected', 'changes_requested') and char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'registration_reason_required'
      using errcode = '23514', constraint = 'registration_decision_reason_required';
  end if;

  select * into v_request from app.student_registration_requests where id = p_request_id for update;
  if not found then raise no_data_found; end if;
  if v_request.status not in ('pending', 'changes_requested') then
    raise exception 'registration_not_reviewable'
      using errcode = '23514', constraint = 'registration_request_reviewable';
  end if;

  if p_decision = 'approved' then
    select password_hash into v_password_hash
    from app.student_registration_credentials where request_id = p_request_id for update;
    if not found then raise exception 'registration_credential_missing'; end if;

    insert into app.users(email, phone_e164, display_name, student_number, role, status, academic_level_id)
    values (v_request.email, v_request.phone_e164, v_request.display_name, v_request.student_number,
            'student', 'active', v_request.academic_level_id)
    returning id into v_user_id;
    insert into app.password_credentials(user_id, password_hash, must_change_password)
    values (v_user_id, v_password_hash, false);
  end if;

  update app.student_registration_requests
  set status = p_decision, decision_reason = case when p_decision = 'approved' then null else left(trim(p_reason), 500) end,
      reviewed_by = p_actor_id, reviewed_at = now(), approved_user_id = v_user_id,
      updated_at = now(), version = version + 1
  where id = p_request_id;

  if p_decision in ('approved', 'rejected') then
    delete from app.student_registration_credentials where request_id = p_request_id;
  end if;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'registration.' || p_decision, 'student_registration', p_request_id,
          jsonb_build_object('approvedUserId', v_user_id, 'reason', nullif(trim(p_reason), '')));
  return v_user_id;
end
$$;

revoke all on app.student_registration_requests, app.student_registration_credentials from public;
revoke all on function app.public_registration_options() from public;
revoke all on function app.create_student_registration(text, text, text, text, uuid, text, bytea, bytea) from public;
revoke all on function app.student_registration_status(bytea) from public;
revoke all on function app.admin_update_student_registration(uuid, uuid, text, text, text, text, uuid) from public;
revoke all on function app.admin_decide_student_registration(uuid, uuid, varchar, text) from public;

grant select on app.student_registration_requests to masar_api_access;
grant execute on function app.public_registration_options(),
  app.create_student_registration(text, text, text, text, uuid, text, bytea, bytea),
  app.student_registration_status(bytea),
  app.admin_update_student_registration(uuid, uuid, text, text, text, text, uuid),
  app.admin_decide_student_registration(uuid, uuid, varchar, text)
  to masar_api_access;

commit;
