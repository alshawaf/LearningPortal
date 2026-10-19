begin;
drop policy if exists learning_activities_write on app.learning_activities;
create policy learning_activities_write on app.learning_activities for all using (
  app.can_access_offering(offering_id,true)
) with check (
  app.can_access_offering(offering_id,true) and (app.current_user_role()='admin' or created_by=app.current_user_id())
);
commit;
