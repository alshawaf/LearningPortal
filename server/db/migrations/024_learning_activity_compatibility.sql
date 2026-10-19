begin;

-- Keep older maintenance tools and import scripts compatible with the new
-- activity aggregate. API callers may still provide activity_id explicitly;
-- direct inserts get a matching activity automatically.
create or replace function app.ensure_practice_learning_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  if new.activity_id is null then
    insert into app.learning_activities(
      offering_id, activity_type, title, description, status, points,
      available_from, source_type, source_id, created_by, created_at, updated_at
    ) values (
      app.resolve_course_offering(new.course_id), 'programming_practice', new.title,
      new.description, new.status, new.points, new.published_at,
      'practice_exercise', new.id, new.created_by, new.created_at, new.updated_at
    ) returning id into new.activity_id;
  end if;
  return new;
end;
$$;

create or replace function app.ensure_assignment_learning_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  if new.activity_id is null then
    insert into app.learning_activities(
      offering_id, activity_type, title, description, status, points,
      available_from, due_at, source_type, source_id, created_by, created_at, updated_at
    ) values (
      app.resolve_course_offering(new.course_id), 'assignment', new.title,
      new.description, case when new.published_at is null then 'draft' else 'published' end,
      new.max_score, new.published_at, new.due_at, 'assignment', new.id,
      new.created_by, new.created_at, new.updated_at
    ) returning id into new.activity_id;
  end if;
  return new;
end;
$$;

create or replace function app.sync_practice_learning_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  update app.learning_activities
     set offering_id = app.resolve_course_offering(new.course_id),
         title = new.title,
         description = new.description,
         status = new.status,
         points = new.points,
         available_from = new.published_at,
         source_type = 'practice_exercise',
         source_id = new.id,
         updated_at = new.updated_at
   where id = new.activity_id;
  return new;
end;
$$;

create or replace function app.sync_assignment_learning_activity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, app
as $$
begin
  update app.learning_activities
     set offering_id = app.resolve_course_offering(new.course_id),
         title = new.title,
         description = new.description,
         status = case when new.published_at is null then 'draft' else 'published' end,
         points = new.max_score,
         available_from = new.published_at,
         due_at = new.due_at,
         source_type = 'assignment',
         source_id = new.id,
         updated_at = new.updated_at
   where id = new.activity_id;
  return new;
end;
$$;

drop trigger if exists practice_ensure_learning_activity on app.practice_exercises;
create trigger practice_ensure_learning_activity
before insert on app.practice_exercises
for each row execute function app.ensure_practice_learning_activity();

drop trigger if exists assignment_ensure_learning_activity on app.assignments;
create trigger assignment_ensure_learning_activity
before insert on app.assignments
for each row execute function app.ensure_assignment_learning_activity();

drop trigger if exists practice_sync_learning_activity on app.practice_exercises;
create trigger practice_sync_learning_activity
after insert or update of course_id, title, description, status, points, published_at, updated_at
on app.practice_exercises
for each row execute function app.sync_practice_learning_activity();

drop trigger if exists assignment_sync_learning_activity on app.assignments;
create trigger assignment_sync_learning_activity
after insert or update of course_id, title, description, due_at, max_score, published_at, updated_at
on app.assignments
for each row execute function app.sync_assignment_learning_activity();

revoke all on function app.ensure_practice_learning_activity() from public;
revoke all on function app.ensure_assignment_learning_activity() from public;
revoke all on function app.sync_practice_learning_activity() from public;
revoke all on function app.sync_assignment_learning_activity() from public;

commit;
