begin;

create table if not exists app.academic_departments (
  id uuid primary key default gen_random_uuid(),
  code varchar(24) not null unique check (code ~ '^[A-Z0-9_-]{2,24}$'),
  name varchar(160) not null unique check (char_length(trim(name)) between 2 and 160),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists app.specializations (
  id uuid primary key default gen_random_uuid(),
  department_id uuid not null references app.academic_departments(id) on delete restrict,
  code varchar(24) not null check (code ~ '^[A-Z0-9_-]{2,24}$'),
  name varchar(160) not null check (char_length(trim(name)) between 2 and 160),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (department_id, code),
  unique (department_id, name)
);

create table if not exists app.academic_levels (
  id uuid primary key default gen_random_uuid(),
  specialization_id uuid not null references app.specializations(id) on delete restrict,
  level_number smallint not null check (level_number between 1 and 20),
  name varchar(120) not null check (char_length(trim(name)) between 2 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (specialization_id, level_number),
  unique (specialization_id, name)
);

create index if not exists specializations_department_id_idx
  on app.specializations(department_id);
create index if not exists academic_levels_specialization_id_idx
  on app.academic_levels(specialization_id);

-- Preserve existing courses under an explicit legacy hierarchy until real
-- institutional data is entered by an administrator.
insert into app.academic_departments(code, name)
values ('LEGACY', 'الدائرة غير المصنفة')
on conflict (code) do nothing;

insert into app.specializations(department_id, code, name)
select id, 'GENERAL', 'التخصص غير المصنف'
from app.academic_departments where code = 'LEGACY'
on conflict (department_id, code) do nothing;

insert into app.academic_levels(specialization_id, level_number, name)
select id, 1, 'المستوى غير المصنف'
from app.specializations where code = 'GENERAL'
  and department_id = (select id from app.academic_departments where code = 'LEGACY')
on conflict (specialization_id, level_number) do nothing;

alter table app.courses add column if not exists level_id uuid;

update app.courses
set level_id = (
  select l.id
  from app.academic_levels l
  join app.specializations s on s.id = l.specialization_id
  join app.academic_departments d on d.id = s.department_id
  where d.code = 'LEGACY' and s.code = 'GENERAL' and l.level_number = 1
)
where level_id is null;

alter table app.courses alter column level_id set not null;

do $$ begin
  alter table app.courses
    add constraint courses_level_id_fkey
    foreign key (level_id) references app.academic_levels(id) on delete restrict;
exception when duplicate_object then null;
end $$;

create index if not exists courses_level_id_idx on app.courses(level_id);

alter table app.academic_departments enable row level security;
alter table app.academic_departments force row level security;
alter table app.specializations enable row level security;
alter table app.specializations force row level security;
alter table app.academic_levels enable row level security;
alter table app.academic_levels force row level security;

drop policy if exists academic_departments_select_policy on app.academic_departments;
create policy academic_departments_select_policy on app.academic_departments for select
  using (app.current_user_id() is not null);
drop policy if exists specializations_select_policy on app.specializations;
create policy specializations_select_policy on app.specializations for select
  using (app.current_user_id() is not null);
drop policy if exists academic_levels_select_policy on app.academic_levels;
create policy academic_levels_select_policy on app.academic_levels for select
  using (app.current_user_id() is not null);

drop function if exists app.admin_create_course(uuid, uuid, text, text);
create function app.admin_create_course(
  p_actor_id uuid, p_owner_user_id uuid, p_level_id uuid, p_code text, p_title text
)
returns uuid
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_course_id uuid;
begin
  if not exists (
    select 1 from app.users
    where id = p_actor_id and role = 'admin' and status = 'active'
  ) then
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

  insert into app.courses(code, title, owner_user_id, level_id)
  values (upper(trim(p_code)), trim(p_title), p_owner_user_id, p_level_id)
  returning id into v_course_id;
  return v_course_id;
end
$$;

revoke all on app.academic_departments, app.specializations, app.academic_levels from public;
grant select on app.academic_departments, app.specializations, app.academic_levels to masar_api_access;
revoke all on function app.admin_create_course(uuid, uuid, uuid, text, text) from public;
grant execute on function app.admin_create_course(uuid, uuid, uuid, text, text) to masar_api_access;

commit;
