-- =====================================================================
-- 20261122140000_admin_password_reset_audit.sql
-- Run AFTER 20261122130000_only_custodians_publish_assets.sql. Apply once.
--
-- Supports the "Set temporary password" button on Users & roles (C1, FR-03, FR-05).
-- The password itself is changed by the server through the Supabase Auth admin API
-- and is NEVER stored or logged here: only the fact that a reset happened.
-- write_audit() is not callable by the app, so this trusted function writes the entry.
-- =====================================================================
begin;

create or replace function public.record_password_reset(p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if public.has_role('admin') is not true then
    raise exception 'Only an administrator can reset passwords.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Use the change-password page to change your own password.';
  end if;
  if not exists (select 1 from public.app_user where user_id = p_user_id) then
    raise exception 'Profile not found.';
  end if;

  perform public.write_audit('TEMPORARY_PASSWORD_SET', 'app_user', p_user_id, null,
    jsonb_build_object('note', 'Administrator set a temporary password. The password is not stored.'));
end;
$$;

revoke execute on function public.record_password_reset(uuid) from public, anon;
grant  execute on function public.record_password_reset(uuid) to authenticated;

commit;
