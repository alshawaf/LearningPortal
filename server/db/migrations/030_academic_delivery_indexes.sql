begin;

-- Foreign-key indexes keep section transfers, restricted deletes, and roster
-- lookups predictable as the number of academic years grows.
create index if not exists academic_sections_cohort_idx
  on app.academic_sections(cohort_id);

create index if not exists course_offerings_section_status_idx
  on app.course_offerings(section_id,status);

create index if not exists section_memberships_year_status_idx
  on app.section_memberships(academic_year_id,status);

create index if not exists section_memberships_assigned_by_idx
  on app.section_memberships(assigned_by)
  where assigned_by is not null;

commit;
