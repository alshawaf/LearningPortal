begin;

-- Calendar hierarchy: an academic year owns any number of ordered terms.
create table app.academic_years (
  id uuid primary key default gen_random_uuid(),
  code varchar(24) not null unique check (code ~ '^[A-Z0-9_-]{2,24}$'),
  name varchar(120) not null check (char_length(trim(name)) between 2 and 120),
  starts_on date,
  ends_on date,
  status varchar(20) not null default 'planned' check (status in ('planned','active','completed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

insert into app.academic_years(code,name,starts_on,ends_on,status)
select 'CURRENT_YEAR','العام الأكاديمي الحالي',min(starts_on),max(ends_on),
       case when bool_or(status='active') then 'active' else 'planned' end
from app.academic_terms;

alter table app.academic_terms add column academic_year_id uuid references app.academic_years(id) on delete restrict;
alter table app.academic_terms add column term_number smallint;
update app.academic_terms
set academic_year_id=(select id from app.academic_years where code='CURRENT_YEAR'),
    term_number=ranked.position
from (
  select id,row_number() over(order by starts_on nulls last,created_at,id)::smallint as position
  from app.academic_terms
) ranked
where app.academic_terms.id=ranked.id;
alter table app.academic_terms alter column academic_year_id set not null;
alter table app.academic_terms alter column term_number set not null;
alter table app.academic_terms add constraint academic_terms_number_check check (term_number between 1 and 6);
alter table app.academic_terms add constraint academic_terms_year_number_key unique(academic_year_id,term_number);
create index academic_terms_year_status_idx on app.academic_terms(academic_year_id,status,term_number);

-- A cohort is the admission batch for one specialization. A section is the
-- actual student group for one level in one academic year.
create table app.student_cohorts (
  id uuid primary key default gen_random_uuid(),
  specialization_id uuid not null references app.specializations(id) on delete restrict,
  code varchar(32) not null check (code ~ '^[A-Z0-9_-]{2,32}$'),
  name varchar(160) not null check (char_length(trim(name)) between 2 and 160),
  admission_year smallint not null check (admission_year between 2000 and 2200),
  status varchar(20) not null default 'active' check (status in ('planned','active','graduated','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(specialization_id,code)
);

create table app.academic_sections (
  id uuid primary key default gen_random_uuid(),
  cohort_id uuid not null references app.student_cohorts(id) on delete restrict,
  level_id uuid not null references app.academic_levels(id) on delete restrict,
  academic_year_id uuid not null references app.academic_years(id) on delete restrict,
  code varchar(32) not null check (code ~ '^[A-Z0-9_-]{1,32}$'),
  name varchar(160) not null check (char_length(trim(name)) between 2 and 160),
  status varchar(20) not null default 'active' check (status in ('planned','active','completed','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(academic_year_id,cohort_id,level_id,code)
);

create table app.section_memberships (
  section_id uuid not null references app.academic_sections(id) on delete cascade,
  student_user_id uuid not null references app.users(id) on delete cascade,
  academic_year_id uuid not null references app.academic_years(id) on delete restrict,
  status varchar(20) not null default 'active' check (status in ('active','withdrawn','completed','suspended')),
  assigned_by uuid references app.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  change_reason varchar(500),
  primary key(section_id,student_user_id),
  unique(student_user_id,academic_year_id)
);

create index student_cohorts_specialization_idx on app.student_cohorts(specialization_id,status);
create index academic_sections_year_level_idx on app.academic_sections(academic_year_id,level_id,status);
create index section_memberships_student_idx on app.section_memberships(student_user_id,status);

create function app.validate_section_context()
returns trigger language plpgsql set search_path=app,pg_temp as $$
begin
  if not exists (
    select 1 from app.student_cohorts c join app.academic_levels l on l.id=new.level_id
    where c.id=new.cohort_id and c.specialization_id=l.specialization_id
  ) then
    raise exception 'section_specialization_mismatch' using errcode='23514',constraint='section_specialization_match';
  end if;
  return new;
end $$;
create trigger academic_sections_validate before insert or update of cohort_id,level_id on app.academic_sections
for each row execute function app.validate_section_context();

create function app.validate_section_membership()
returns trigger language plpgsql set search_path=app,pg_temp as $$
begin
  select academic_year_id into new.academic_year_id from app.academic_sections where id=new.section_id;
  if not found then raise no_data_found; end if;
  if not exists(select 1 from app.users where id=new.student_user_id and role='student' and status='active') then
    raise exception 'student_must_be_active' using errcode='23514',constraint='section_member_active_student';
  end if;
  return new;
end $$;
create trigger section_memberships_validate before insert or update of section_id,student_user_id on app.section_memberships
for each row execute function app.validate_section_membership();

-- Migrate the experimental data into one real year, cohorts, and sections.
insert into app.student_cohorts(specialization_id,code,name,admission_year,status)
select distinct l.specialization_id,
       'MIGRATED_'||upper(left(replace(l.specialization_id::text,'-',''),12)),
       'الدفعة المرحّلة',extract(year from current_date)::smallint,'active'
from app.courses c join app.academic_levels l on l.id=c.level_id
on conflict(specialization_id,code) do nothing;

insert into app.academic_sections(cohort_id,level_id,academic_year_id,code,name,status)
select distinct sc.id,c.level_id,t.academic_year_id,o.section_code,
       'الشعبة '||o.section_code,
       case when o.status='archived' then 'archived' else 'active' end
from app.course_offerings o
join app.courses c on c.id=o.course_id
join app.academic_levels l on l.id=c.level_id
join app.student_cohorts sc on sc.specialization_id=l.specialization_id and sc.code like 'MIGRATED_%'
join app.academic_terms t on t.id=o.term_id
on conflict(academic_year_id,cohort_id,level_id,code) do nothing;

alter table app.course_offerings add column section_id uuid references app.academic_sections(id) on delete restrict;
update app.course_offerings o set section_id=sx.id
from app.courses c,app.academic_levels l,app.academic_terms t,app.student_cohorts sc,app.academic_sections sx
where c.id=o.course_id and l.id=c.level_id and t.id=o.term_id
  and sc.specialization_id=l.specialization_id and sc.code like 'MIGRATED_%'
  and sx.cohort_id=sc.id and sx.level_id=l.id and sx.academic_year_id=t.academic_year_id and sx.code=o.section_code;
alter table app.course_offerings alter column section_id set not null;

insert into app.section_memberships(section_id,student_user_id,academic_year_id,status,assigned_by,joined_at,status_changed_at,change_reason)
select distinct on(m.user_id,t.academic_year_id) o.section_id,m.user_id,t.academic_year_id,m.enrollment_status,m.enrolled_by,m.enrolled_at,m.status_changed_at,m.removal_reason
from app.course_offering_members m join app.course_offerings o on o.id=m.offering_id
join app.academic_terms t on t.id=o.term_id
where m.membership_role='student'
order by m.user_id,t.academic_year_id,(m.enrollment_status='active') desc,m.enrolled_at
on conflict(student_user_id,academic_year_id) do nothing;

-- Remove automatic course creation/enrolment. The catalog is now independent.
drop trigger if exists courses_create_default_offering on app.courses;
drop trigger if exists offerings_auto_enroll_students on app.course_offerings;
drop trigger if exists students_auto_enroll_offerings on app.users;
drop function if exists app.create_default_course_offering();
drop function if exists app.auto_enroll_for_offering_change();
drop function if exists app.auto_enroll_student_in_offerings();
drop function if exists app.sync_offering_students(uuid,uuid);
drop function if exists app.admin_add_offering_student(uuid,uuid,uuid);
drop function if exists app.admin_set_offering_enrollment_status(uuid,uuid,uuid,varchar,varchar);
drop function if exists app.admin_create_course(uuid,uuid,uuid,text,text);
drop function if exists app.admin_update_course(uuid,uuid,uuid,uuid,text,text);

-- Rebuild access control from section membership. The instructor belongs to the
-- offering, never to the catalog course.
create or replace function app.can_access_offering(p_offering_id uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path=app,pg_temp as $$
  select case
    when app.current_user_id() is null then false
    when app.current_user_role()='admin' then true
    when exists(select 1 from app.course_offerings o where o.id=p_offering_id and o.instructor_user_id=app.current_user_id()) then true
    when not p_write and exists(
      select 1 from app.course_offerings o join app.section_memberships m on m.section_id=o.section_id
      where o.id=p_offering_id and o.status='active' and m.student_user_id=app.current_user_id() and m.status='active'
    ) then true else false end
$$;

create or replace function app.can_access_course(p_course_id uuid,p_write boolean default false)
returns boolean language sql stable security definer set search_path=app,pg_temp as $$
  select case
    when app.current_user_id() is null then false
    when app.current_user_role()='admin' then true
    when exists(select 1 from app.course_offerings o where o.course_id=p_course_id and app.can_access_offering(o.id,p_write)) then true
    else false end
$$;

drop policy if exists users_select_policy on app.users;
create policy users_select_policy on app.users for select using (
  id=app.current_user_id() or app.current_user_role()='admin'
  or (app.current_user_role()='instructor' and exists(
    select 1 from app.course_offerings o join app.section_memberships m on m.section_id=o.section_id
    where o.instructor_user_id=app.current_user_id() and m.student_user_id=users.id
  ))
  or exists(select 1 from app.course_offerings o where o.instructor_user_id=users.id and app.can_access_offering(o.id,false))
);

drop policy if exists courses_insert_policy on app.courses;
drop policy if exists courses_update_policy on app.courses;
create policy courses_insert_policy on app.courses for insert with check(app.current_user_role()='admin');
create policy courses_update_policy on app.courses for update using(app.current_user_role()='admin') with check(app.current_user_role()='admin');

-- Replace the former enrollment table with a read-only projection. There is a
-- single source of truth: section_memberships.
drop table app.course_offering_members;
create view app.course_offering_members with(security_invoker=true) as
select o.id as offering_id,m.student_user_id as user_id,'student'::app.app_role as membership_role,
       m.status as enrollment_status,'section'::varchar(20) as enrollment_type,m.assigned_by as enrolled_by,
       m.joined_at as enrolled_at,m.status_changed_at,null::timestamptz as removed_at,m.change_reason as removal_reason
from app.course_offerings o join app.section_memberships m on m.section_id=o.section_id;

alter table app.academic_years enable row level security;
alter table app.academic_years force row level security;
alter table app.student_cohorts enable row level security;
alter table app.student_cohorts force row level security;
alter table app.academic_sections enable row level security;
alter table app.academic_sections force row level security;
alter table app.section_memberships enable row level security;
alter table app.section_memberships force row level security;

create policy academic_years_select on app.academic_years for select using(app.current_user_id() is not null);
create policy academic_years_admin on app.academic_years for all using(app.current_user_role()='admin') with check(app.current_user_role()='admin');
create policy student_cohorts_select on app.student_cohorts for select using(app.current_user_id() is not null);
create policy student_cohorts_admin on app.student_cohorts for all using(app.current_user_role()='admin') with check(app.current_user_role()='admin');
create policy academic_sections_select on app.academic_sections for select using(
  app.current_user_role()='admin' or exists(select 1 from app.course_offerings o where o.section_id=id and app.can_access_offering(o.id,false))
  or exists(select 1 from app.section_memberships m where m.section_id=id and m.student_user_id=app.current_user_id())
);
create policy academic_sections_admin on app.academic_sections for all using(app.current_user_role()='admin') with check(app.current_user_role()='admin');
create policy section_memberships_select on app.section_memberships for select using(
  student_user_id=app.current_user_id() or app.current_user_role()='admin'
  or exists(select 1 from app.course_offerings o where o.section_id=section_id and o.instructor_user_id=app.current_user_id())
);
create policy section_memberships_admin on app.section_memberships for all using(app.current_user_role()='admin') with check(app.current_user_role()='admin');

-- The operational relationship is now unique by course, term, and real section.
alter table app.course_offerings drop constraint if exists course_offerings_course_id_term_id_section_code_key;
alter table app.course_offerings add constraint course_offerings_course_term_section_key unique(course_id,term_id,section_id);
drop index if exists app.courses_owner_user_id_idx;
drop index if exists app.courses_level_id_idx;
alter table app.course_offerings drop column section_code;
alter table app.courses drop column owner_user_id;
alter table app.courses drop column level_id;

revoke all on app.academic_years,app.student_cohorts,app.academic_sections,app.section_memberships,app.course_offering_members from public;
grant select,insert,update on app.academic_years,app.student_cohorts,app.academic_sections,app.section_memberships to masar_api_access;
grant select on app.course_offering_members to masar_api_access;
grant delete on app.section_memberships to masar_api_access;
revoke all on function app.validate_section_context(),app.validate_section_membership() from public;

commit;
