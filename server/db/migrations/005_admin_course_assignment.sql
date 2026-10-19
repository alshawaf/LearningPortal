begin;

drop policy if exists courses_insert_policy on app.courses;
create policy courses_insert_policy on app.courses for insert
  with check (app.current_user_role() = 'admin');

create or replace function app.admin_create_course(
  p_actor_id uuid, p_owner_user_id uuid, p_code text, p_title text
)
returns uuid
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare v_course_id uuid;
begin
  if not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;

  if not exists (
    select 1 from app.users
    where id = p_owner_user_id and role = 'instructor' and status = 'active'
    for key share
  ) then
    raise exception 'course_owner_must_be_active_instructor'
      using errcode = '23514', constraint = 'course_owner_active_instructor';
  end if;

  insert into app.courses(code, title, owner_user_id)
  values (upper(trim(p_code)), trim(p_title), p_owner_user_id)
  returning id into v_course_id;
  return v_course_id;
end
$$;

revoke all on function app.admin_create_course(uuid, uuid, text, text) from public;
grant execute on function app.admin_create_course(uuid, uuid, text, text) to masar_api_access;

commit;
