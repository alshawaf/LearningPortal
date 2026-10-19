begin;

create or replace function app.validate_course_offering_integrity()
returns trigger language plpgsql security definer set search_path=app,pg_temp as $$
begin
  if not exists (
    select 1 from app.users u where u.id=new.instructor_user_id and u.role='instructor' and u.status='active'
  ) then
    raise exception 'offering_instructor_must_be_active'
      using errcode='23514',constraint='course_offering_active_instructor';
  end if;
  return new;
end $$;

create or replace function app.validate_course_offering_member_integrity()
returns trigger language plpgsql security definer set search_path=app,pg_temp as $$
begin
  if not exists (
    select 1 from app.users u where u.id=new.user_id and u.status='active' and u.role=new.membership_role
  ) then
    raise exception 'offering_member_role_mismatch'
      using errcode='23514',constraint='course_offering_member_active_role';
  end if;
  return new;
end $$;

drop trigger if exists course_offerings_integrity on app.course_offerings;
create trigger course_offerings_integrity before insert or update of instructor_user_id on app.course_offerings
for each row execute function app.validate_course_offering_integrity();
drop trigger if exists course_offering_members_integrity on app.course_offering_members;
create trigger course_offering_members_integrity before insert or update of user_id,membership_role on app.course_offering_members
for each row execute function app.validate_course_offering_member_integrity();

revoke all on function app.validate_course_offering_integrity(),app.validate_course_offering_member_integrity() from public;
commit;
