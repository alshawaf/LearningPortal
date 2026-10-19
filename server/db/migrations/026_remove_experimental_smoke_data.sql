-- Remove records left by older smoke tests. These rows predate transactional
-- test cleanup and are not part of the portal's retained demonstration data.

create temporary table cleanup_test_courses on commit drop as
select id from app.courses
where code ~ '^(ENR|QA|RG|CRS)[0-9]+U?$';

create temporary table cleanup_test_users on commit drop as
select id from app.users
where email::text ~ '^(course\.|enroll\.|registration\.|practice\.|activity\.|architecture-|smoke-)';

delete from app.practice_exercises
where activity_id in (
  select a.id from app.learning_activities a
  join app.course_offerings o on o.id=a.offering_id
  where o.course_id in (select id from cleanup_test_courses)
);

delete from app.assignments
where activity_id in (
  select a.id from app.learning_activities a
  join app.course_offerings o on o.id=a.offering_id
  where o.course_id in (select id from cleanup_test_courses)
);

delete from app.learning_activities
where offering_id in (
  select id from app.course_offerings
  where course_id in (select id from cleanup_test_courses)
);

delete from app.course_offering_members
where offering_id in (
  select id from app.course_offerings
  where course_id in (select id from cleanup_test_courses)
);

delete from app.course_offerings
where course_id in (select id from cleanup_test_courses);

delete from app.courses
where id in (select id from cleanup_test_courses);

delete from app.student_registration_requests
where approved_user_id in (select id from cleanup_test_users)
   or email::text ~ '^(registration\.|smoke-)';

delete from app.audit_logs
where actor_user_id in (select id from cleanup_test_users)
   or target_id in (select id from cleanup_test_users);

delete from app.users
where id in (select id from cleanup_test_users);
