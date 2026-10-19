begin;

alter table app.section_memberships
  drop constraint if exists section_memberships_student_user_id_academic_year_id_key;

create unique index section_memberships_one_active_per_year
  on app.section_memberships(student_user_id,academic_year_id)
  where status='active';

commit;
