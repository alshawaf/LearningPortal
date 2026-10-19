begin;

drop policy if exists academic_sections_select on app.academic_sections;
create policy academic_sections_select on app.academic_sections for select using(
  app.current_user_role()='admin'
  or exists(
    select 1 from app.course_offerings o
    where o.section_id=academic_sections.id and app.can_access_offering(o.id,false)
  )
  or exists(
    select 1 from app.section_memberships m
    where m.section_id=academic_sections.id and m.student_user_id=app.current_user_id()
  )
);

drop policy if exists section_memberships_select on app.section_memberships;
create policy section_memberships_select on app.section_memberships for select using(
  student_user_id=app.current_user_id() or app.current_user_role()='admin'
  or exists(
    select 1 from app.course_offerings o
    where o.section_id=section_memberships.section_id and o.instructor_user_id=app.current_user_id()
  )
);

commit;
