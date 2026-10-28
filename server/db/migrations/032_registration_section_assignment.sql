begin;

create or replace function app.admin_decide_student_registration_with_section(
  p_actor_id uuid, p_request_id uuid, p_decision varchar, p_reason text, p_section_id uuid
)
returns uuid
language plpgsql security definer
set search_path = app, pg_temp
as $$
declare
  v_request app.student_registration_requests%rowtype;
  v_password_hash text;
  v_user_id uuid;
  v_academic_year_id uuid;
begin
  if p_actor_id is distinct from app.current_user_id()
     or app.current_user_role() <> 'admin'
     or not exists (select 1 from app.users where id = p_actor_id and role = 'admin' and status = 'active') then
    raise insufficient_privilege;
  end if;
  if p_decision not in ('approved', 'rejected', 'changes_requested') then raise check_violation; end if;
  if p_decision in ('rejected', 'changes_requested') and char_length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'registration_reason_required' using errcode = '23514', constraint = 'registration_decision_reason_required';
  end if;
  if p_decision = 'approved' and p_section_id is null then
    raise exception 'registration_section_required' using errcode = '23514', constraint = 'registration_section_required';
  end if;

  select * into v_request from app.student_registration_requests where id = p_request_id for update;
  if not found then raise no_data_found; end if;
  if v_request.status not in ('pending', 'changes_requested') then
    raise exception 'registration_not_reviewable' using errcode = '23514', constraint = 'registration_request_reviewable';
  end if;

  if p_decision = 'approved' then
    select x.academic_year_id into v_academic_year_id
    from app.academic_sections x join app.academic_years y on y.id=x.academic_year_id
    where x.id=p_section_id and x.level_id=v_request.academic_level_id
      and x.status='active' and y.status='active'
    for key share of x,y;
    if not found then
      raise exception 'registration_section_mismatch' using errcode='23514',constraint='registration_section_eligible';
    end if;

    select password_hash into v_password_hash
    from app.student_registration_credentials where request_id = p_request_id for update;
    if not found then raise exception 'registration_credential_missing'; end if;

    insert into app.users(email, phone_e164, display_name, student_number, role, status, academic_level_id)
    values (v_request.email, v_request.phone_e164, v_request.display_name, v_request.student_number,
            'student', 'active', v_request.academic_level_id)
    returning id into v_user_id;
    insert into app.password_credentials(user_id, password_hash, must_change_password)
    values (v_user_id, v_password_hash, false);
    insert into app.section_memberships(section_id,student_user_id,academic_year_id,status,assigned_by)
    values(p_section_id,v_user_id,v_academic_year_id,'active',p_actor_id);
  end if;

  update app.student_registration_requests
  set status = p_decision, decision_reason = case when p_decision = 'approved' then null else left(trim(p_reason), 500) end,
      reviewed_by = p_actor_id, reviewed_at = now(), approved_user_id = v_user_id,
      updated_at = now(), version = version + 1
  where id = p_request_id;

  if p_decision in ('approved', 'rejected') then
    delete from app.student_registration_credentials where request_id = p_request_id;
  end if;

  insert into app.audit_logs(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'registration.' || p_decision, 'student_registration', p_request_id,
          jsonb_build_object('approvedUserId', v_user_id, 'sectionId', p_section_id, 'reason', nullif(trim(p_reason), '')));
  return v_user_id;
end
$$;

revoke all on function app.admin_decide_student_registration_with_section(uuid,uuid,varchar,text,uuid) from public;
grant execute on function app.admin_decide_student_registration_with_section(uuid,uuid,varchar,text,uuid) to masar_api_access;

commit;
