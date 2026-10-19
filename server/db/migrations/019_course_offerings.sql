begin;

create table app.academic_terms (
  id uuid primary key default gen_random_uuid(),
  code varchar(32) not null unique check (code ~ '^[A-Z0-9_-]{2,32}$'),
  name varchar(120) not null check (char_length(trim(name)) between 2 and 120),
  starts_on date,
  ends_on date,
  status varchar(20) not null default 'planned' check (status in ('planned','active','completed','archived')),
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table app.course_offerings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references app.courses(id) on delete restrict,
  term_id uuid not null references app.academic_terms(id) on delete restrict,
  instructor_user_id uuid not null references app.users(id) on delete restrict,
  section_code varchar(32) not null default 'MAIN',
  status varchar(20) not null default 'planned' check (status in ('planned','active','completed','archived')),
  is_legacy boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, term_id, section_code)
);
create unique index course_offerings_one_legacy_per_course on app.course_offerings(course_id) where is_legacy;
create index course_offerings_term_status_idx on app.course_offerings(term_id, status);
create index course_offerings_instructor_idx on app.course_offerings(instructor_user_id, status);

create table app.course_offering_members (
  offering_id uuid not null references app.course_offerings(id) on delete cascade,
  user_id uuid not null references app.users(id) on delete cascade,
  membership_role app.app_role not null check (membership_role in ('instructor','student')),
  enrollment_status varchar(20) not null default 'active' check (enrollment_status in ('active','withdrawn','completed','suspended')),
  enrollment_type varchar(20) not null default 'manual' check (enrollment_type in ('automatic','manual','legacy')),
  enrolled_by uuid references app.users(id) on delete set null,
  enrolled_at timestamptz not null default now(),
  status_changed_at timestamptz not null default now(),
  removed_at timestamptz,
  removal_reason varchar(500),
  primary key (offering_id, user_id)
);
create index course_offering_members_user_idx on app.course_offering_members(user_id, enrollment_status);

insert into app.academic_terms(code, name, status, is_system)
values ('LEGACY', 'السجل الأكاديمي الحالي', 'active', true)
on conflict (code) do nothing;

insert into app.course_offerings(course_id, term_id, instructor_user_id, section_code, status, is_legacy)
select c.id, t.id, c.owner_user_id, 'MAIN', case when c.is_active then 'active' else 'archived' end, true
from app.courses c cross join app.academic_terms t
where t.code = 'LEGACY'
on conflict (course_id, term_id, section_code) do nothing;

insert into app.course_offering_members(
  offering_id, user_id, membership_role, enrollment_status, enrollment_type,
  enrolled_by, enrolled_at, status_changed_at, removed_at, removal_reason
)
select o.id, cm.user_id, cm.membership_role, cm.enrollment_status, 'legacy',
       cm.enrolled_by, cm.enrolled_at, cm.status_changed_at, cm.removed_at, cm.removal_reason
from app.course_members cm
join app.course_offerings o on o.course_id=cm.course_id and o.is_legacy
on conflict (offering_id, user_id) do update set
  membership_role=excluded.membership_role,
  enrollment_status=excluded.enrollment_status,
  status_changed_at=excluded.status_changed_at,
  removed_at=excluded.removed_at,
  removal_reason=excluded.removal_reason;

create or replace function app.can_access_offering(p_offering_id uuid, p_write boolean default false)
returns boolean language sql stable security definer set search_path=app,pg_temp as $$
  select case
    when app.current_user_id() is null then false
    when app.current_user_role()='admin' then true
    when exists (select 1 from app.course_offerings o where o.id=p_offering_id and o.instructor_user_id=app.current_user_id()) then true
    when not p_write and exists (
      select 1 from app.course_offering_members m join app.course_offerings o on o.id=m.offering_id
      where m.offering_id=p_offering_id and m.user_id=app.current_user_id()
        and m.enrollment_status='active' and o.status='active'
    ) then true
    else false end
$$;

create or replace function app.resolve_course_offering(p_course_id uuid)
returns uuid language plpgsql stable security definer set search_path=app,pg_temp as $$
declare v_id uuid;
begin
  select id into v_id from app.course_offerings
  where course_id=p_course_id and is_legacy order by created_at limit 1;
  if v_id is null then raise no_data_found; end if;
  return v_id;
end $$;

create or replace function app.sync_legacy_course_offering()
returns trigger language plpgsql security definer set search_path=app,pg_temp as $$
declare v_term_id uuid; v_offering_id uuid; v_course_id uuid;
begin
  if tg_table_name='courses' then
    select id into v_term_id from app.academic_terms where code='LEGACY';
    insert into app.course_offerings(course_id,term_id,instructor_user_id,section_code,status,is_legacy)
    values (new.id,v_term_id,new.owner_user_id,'MAIN',case when new.is_active then 'active' else 'archived' end,true)
    on conflict (course_id) where is_legacy do update set
      instructor_user_id=excluded.instructor_user_id,status=excluded.status,updated_at=now();
    return new;
  end if;
  if tg_op='DELETE' then
    v_course_id := old.course_id;
    select id into v_offering_id from app.course_offerings where course_id=v_course_id and is_legacy;
    delete from app.course_offering_members where offering_id=v_offering_id and user_id=old.user_id;
    return old;
  end if;
  v_course_id := new.course_id;
  select id into v_offering_id from app.course_offerings where course_id=v_course_id and is_legacy;
  if v_offering_id is null then
    select id into v_term_id from app.academic_terms where code='LEGACY';
    insert into app.course_offerings(course_id,term_id,instructor_user_id,section_code,status,is_legacy)
    select c.id,v_term_id,c.owner_user_id,'MAIN',case when c.is_active then 'active' else 'archived' end,true
    from app.courses c where c.id=v_course_id
    on conflict (course_id) where is_legacy do update set updated_at=now()
    returning id into v_offering_id;
  end if;
  insert into app.course_offering_members(
    offering_id,user_id,membership_role,enrollment_status,enrollment_type,enrolled_by,enrolled_at,status_changed_at,removed_at,removal_reason
  ) values (
    v_offering_id,new.user_id,new.membership_role,new.enrollment_status,'legacy',new.enrolled_by,new.enrolled_at,new.status_changed_at,new.removed_at,new.removal_reason
  ) on conflict (offering_id,user_id) do update set
    membership_role=excluded.membership_role,enrollment_status=excluded.enrollment_status,
    status_changed_at=excluded.status_changed_at,removed_at=excluded.removed_at,removal_reason=excluded.removal_reason;
  return new;
end $$;

drop trigger if exists courses_sync_legacy_offering on app.courses;
create trigger courses_sync_legacy_offering after insert or update of owner_user_id,is_active on app.courses
for each row execute function app.sync_legacy_course_offering();
drop trigger if exists course_members_sync_legacy_offering on app.course_members;
create trigger course_members_sync_legacy_offering after insert or update or delete on app.course_members
for each row execute function app.sync_legacy_course_offering();

alter table app.academic_terms enable row level security;
alter table app.academic_terms force row level security;
alter table app.course_offerings enable row level security;
alter table app.course_offerings force row level security;
alter table app.course_offering_members enable row level security;
alter table app.course_offering_members force row level security;

create policy academic_terms_select on app.academic_terms for select using (app.current_user_id() is not null);
create policy academic_terms_admin_write on app.academic_terms for all using (app.current_user_role()='admin') with check (app.current_user_role()='admin');
create policy course_offerings_select on app.course_offerings for select using (app.can_access_offering(id,false));
create policy course_offerings_admin_write on app.course_offerings for all using (app.current_user_role()='admin') with check (app.current_user_role()='admin');
create policy course_offering_members_select on app.course_offering_members for select using (app.can_access_offering(offering_id,false));
create policy course_offering_members_admin_write on app.course_offering_members for all using (app.current_user_role()='admin') with check (app.current_user_role()='admin');

revoke all on app.academic_terms,app.course_offerings,app.course_offering_members from public;
grant select,insert,update on app.academic_terms,app.course_offerings,app.course_offering_members to masar_api_access;
grant delete on app.course_offering_members to masar_api_access;
revoke all on function app.can_access_offering(uuid,boolean),app.resolve_course_offering(uuid),app.sync_legacy_course_offering() from public;
grant execute on function app.can_access_offering(uuid,boolean),app.resolve_course_offering(uuid) to masar_api_access;

commit;
