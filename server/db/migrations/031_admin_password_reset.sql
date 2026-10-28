begin;

create or replace function app.admin_reset_user_password(
  p_actor_id uuid, p_target_id uuid, p_password_hash text
)
returns void
language plpgsql security definer
set search_path = app, pg_temp
as $$
begin
  if not exists (
    select 1 from app.users
    where id = p_actor_id and role = 'admin' and status = 'active'
  ) then
    raise insufficient_privilege;
  end if;

  perform 1 from app.users where id = p_target_id for update;
  if not found then raise no_data_found; end if;

  update app.password_credentials
  set password_hash = p_password_hash,
      changed_at = now(),
      must_change_password = true
  where user_id = p_target_id;
  if not found then raise no_data_found; end if;

  update app.users
  set failed_login_attempts = 0,
      locked_until = null,
      updated_at = now(),
      version = version + 1
  where id = p_target_id;

  update app.sessions
  set revoked_at = coalesce(revoked_at, now())
  where user_id = p_target_id;
end
$$;

revoke all on function app.admin_reset_user_password(uuid, uuid, text) from public;
grant execute on function app.admin_reset_user_password(uuid, uuid, text) to masar_api_access;

commit;
