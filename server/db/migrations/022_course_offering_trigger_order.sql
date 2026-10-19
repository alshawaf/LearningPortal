begin;
create or replace function app.sync_legacy_course_offering()
returns trigger language plpgsql security definer set search_path=app,pg_temp as $$
declare v_term_id uuid; v_offering_id uuid; v_course_id uuid;
begin
  if tg_table_name='courses' then
    select id into v_term_id from app.academic_terms where code='LEGACY';
    insert into app.course_offerings(course_id,term_id,instructor_user_id,section_code,status,is_legacy)
    values (new.id,v_term_id,new.owner_user_id,'MAIN',case when new.is_active then 'active' else 'archived' end,true)
    on conflict (course_id) where is_legacy do update set
      instructor_user_id=excluded.instructor_user_id,status=excluded.status,updated_at=now();
    return new;
  end if;
  if tg_op='DELETE' then
    v_course_id := old.course_id;
    select id into v_offering_id from app.course_offerings where course_id=v_course_id and is_legacy;
    delete from app.course_offering_members where offering_id=v_offering_id and user_id=old.user_id;
    return old;
  end if;
  v_course_id := new.course_id;
  select id into v_offering_id from app.course_offerings where course_id=v_course_id and is_legacy;
  if v_offering_id is null then
    select id into v_term_id from app.academic_terms where code='LEGACY';
    insert into app.course_offerings(course_id,term_id,instructor_user_id,section_code,status,is_legacy)
    select c.id,v_term_id,c.owner_user_id,'MAIN',case when c.is_active then 'active' else 'archived' end,true
    from app.courses c where c.id=v_course_id
    on conflict (course_id) where is_legacy do update set updated_at=now()
    returning id into v_offering_id;
  end if;
  insert into app.course_offering_members(
    offering_id,user_id,membership_role,enrollment_status,enrollment_type,enrolled_by,enrolled_at,status_changed_at,removed_at,removal_reason
  ) values (
    v_offering_id,new.user_id,new.membership_role,new.enrollment_status,'legacy',new.enrolled_by,new.enrolled_at,new.status_changed_at,new.removed_at,new.removal_reason
  ) on conflict (offering_id,user_id) do update set
    membership_role=excluded.membership_role,enrollment_status=excluded.enrollment_status,
    status_changed_at=excluded.status_changed_at,removed_at=excluded.removed_at,removal_reason=excluded.removal_reason;
  return new;
end $$;
revoke all on function app.sync_legacy_course_offering() from public;
commit;
