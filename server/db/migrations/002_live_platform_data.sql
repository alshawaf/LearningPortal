begin;

alter table app.assignments
  add column if not exists language varchar(20) not null default 'python'
    check (language in ('python', 'javascript')),
  add column if not exists starter_code text not null default '';

create table if not exists app.submissions (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references app.assignments(id) on delete cascade,
  student_user_id uuid not null references app.users(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  source_code text not null check (char_length(source_code) between 1 and 100000),
  status varchar(20) not null default 'submitted' check (status in ('submitted', 'graded')),
  score numeric(7,2),
  feedback text,
  submitted_at timestamptz not null default now(),
  graded_at timestamptz,
  graded_by uuid references app.users(id) on delete set null,
  unique (assignment_id, student_user_id, attempt_number),
  check (score is null or score >= 0)
);

create index if not exists submissions_student_submitted_idx
  on app.submissions(student_user_id, submitted_at desc);
create index if not exists submissions_assignment_submitted_idx
  on app.submissions(assignment_id, submitted_at desc);
create index if not exists submissions_pending_idx
  on app.submissions(assignment_id, submitted_at desc) where status = 'submitted';

alter table app.submissions enable row level security;
alter table app.submissions force row level security;

drop policy if exists users_select_policy on app.users;
create policy users_select_policy on app.users for select using (
  id = app.current_user_id()
  or app.current_user_role() = 'admin'
  or (
    app.current_user_role() = 'instructor'
    and exists (
      select 1 from app.course_members cm
      where cm.user_id = users.id
        and cm.membership_role = 'student'
        and app.can_access_course(cm.course_id, true)
    )
  )
  or exists (
    select 1 from app.courses c
    where c.owner_user_id = users.id and app.can_access_course(c.id, false)
  )
);

drop policy if exists submissions_select_policy on app.submissions;
create policy submissions_select_policy on app.submissions for select using (
  student_user_id = app.current_user_id()
  or app.current_user_role() = 'admin'
  or exists (
    select 1 from app.assignments a
    where a.id = assignment_id and app.can_access_course(a.course_id, true)
  )
);

drop policy if exists submissions_insert_policy on app.submissions;
create policy submissions_insert_policy on app.submissions for insert with check (
  app.current_user_role() = 'student'
  and student_user_id = app.current_user_id()
  and exists (
    select 1 from app.assignments a
    where a.id = assignment_id
      and a.published_at is not null
      and app.can_access_course(a.course_id, false)
  )
);

drop policy if exists submissions_grade_policy on app.submissions;
create policy submissions_grade_policy on app.submissions for update
  using (
    app.current_user_role() = 'admin'
    or exists (
      select 1 from app.assignments a
      where a.id = assignment_id and app.can_access_course(a.course_id, true)
    )
  )
  with check (
    app.current_user_role() = 'admin'
    or exists (
      select 1 from app.assignments a
      where a.id = assignment_id and app.can_access_course(a.course_id, true)
    )
  );

grant select, insert, update on app.submissions to masar_api_access;

commit;
