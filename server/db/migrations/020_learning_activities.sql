begin;

create table app.learning_activities (
  id uuid primary key default gen_random_uuid(),
  offering_id uuid not null references app.course_offerings(id) on delete restrict,
  activity_type varchar(32) not null check (activity_type in ('programming_practice','assignment','quiz','short_answer','file_submission','exam')),
  title varchar(180) not null check (char_length(trim(title)) between 3 and 180),
  description text not null default '',
  status varchar(20) not null default 'draft' check (status in ('draft','published','archived')),
  points numeric(9,2) not null default 0 check (points >= 0),
  available_from timestamptz,
  due_at timestamptz,
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 10080),
  source_type varchar(32),
  source_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid not null references app.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type,source_id),
  check (due_at is null or available_from is null or due_at >= available_from)
);
create index learning_activities_offering_status_idx on app.learning_activities(offering_id,status,created_at desc);
create index learning_activities_type_idx on app.learning_activities(activity_type,status);

insert into app.learning_activities(
  offering_id,activity_type,title,description,status,points,available_from,source_type,source_id,created_by,created_at,updated_at
)
select app.resolve_course_offering(e.course_id),'programming_practice',e.title,e.description,e.status,e.points,e.published_at,
       'practice_exercise',e.id,e.created_by,e.created_at,e.updated_at
from app.practice_exercises e on conflict (source_type,source_id) do nothing;

insert into app.learning_activities(
  offering_id,activity_type,title,description,status,points,available_from,due_at,source_type,source_id,created_by,created_at,updated_at
)
select app.resolve_course_offering(a.course_id),'assignment',a.title,a.description,
       case when a.published_at is null then 'draft' else 'published' end,a.max_score,a.published_at,a.due_at,
       'assignment',a.id,a.created_by,a.created_at,a.updated_at
from app.assignments a on conflict (source_type,source_id) do nothing;

alter table app.practice_exercises add column activity_id uuid references app.learning_activities(id) on delete restrict;
alter table app.assignments add column activity_id uuid references app.learning_activities(id) on delete restrict;
update app.practice_exercises e set activity_id=a.id from app.learning_activities a where a.source_type='practice_exercise' and a.source_id=e.id;
update app.assignments x set activity_id=a.id from app.learning_activities a where a.source_type='assignment' and a.source_id=x.id;
alter table app.practice_exercises alter column activity_id set not null;
alter table app.assignments alter column activity_id set not null;
create unique index practice_exercises_activity_unique on app.practice_exercises(activity_id);
create unique index assignments_activity_unique on app.assignments(activity_id);

alter table app.learning_activities enable row level security;
alter table app.learning_activities force row level security;
create policy learning_activities_select on app.learning_activities for select using (
  app.can_access_offering(offering_id,false) and (status='published' or app.can_access_offering(offering_id,true))
);
create policy learning_activities_write on app.learning_activities for all using (
  app.can_access_offering(offering_id,true)
) with check (
  app.can_access_offering(offering_id,true) and (app.current_user_role()='admin' or created_by=app.current_user_id())
);

revoke all on app.learning_activities from public;
grant select,insert,update on app.learning_activities to masar_api_access;

commit;
