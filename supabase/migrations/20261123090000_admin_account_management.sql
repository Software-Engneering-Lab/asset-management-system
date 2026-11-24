-- =====================================================================
-- 20261123090000_admin_account_management.sql
-- Run AFTER 20261122140000_admin_password_reset_audit.sql. Apply once.
--
-- Makes account management match Phase 4–5:
--   * Figure 2.2a (Level 2 DFD, Process 1.0): 1.2 "Validate Account and Role Data"
--     then 1.4 "Save Accounts, Roles and Departments" – validated and saved as ONE
--     step, with an audit entry (D9) and a confirmation to the administrator.
--   * Figure 8.2a (class diagram): AppUser "holds" Role 1..* – every user has at
--     least one role; Department "employs" AppUser 1 – every user has a department.
--   * FR-03: create, UPDATE, disable and reactivate accounts.
--
--  1. admin_create_account(): profile + roles in one transaction, one audit entry.
--  2. admin_update_profile(): change name / department, audited with before and after.
--  3. remove_user_role(): same as Budoor's version, but the LAST role cannot be removed.
-- Uses the team's has_role() and write_audit() (20261114090000_budoor_access_and_assets.sql).
-- =====================================================================
begin;

-- ---------- 1. Create account: validate (1.2) + save (1.4) in one step ----------
create or replace function public.admin_create_account(
  p_user_id uuid, p_full_name text, p_department_id uuid, p_role_ids uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_roles text[];
begin
  if public.has_role('admin') is not true then
    raise exception 'Only an administrator can create accounts.';
  end if;

  -- 1.2 Validate account and role data
  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then raise exception 'Login account not found.'; end if;
  if exists (select 1 from public.app_user where user_id = p_user_id) then
    raise exception 'This account already has a profile.';
  end if;
  if exists (select 1 from public.app_user where lower(email) = lower(v_email)) then
    raise exception 'Email: this email is already used by another account.';
  end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Full name is required.'; end if;
  if not exists (select 1 from public.department where department_id = p_department_id and is_active) then
    raise exception 'Department: choose an active department.';
  end if;
  if p_role_ids is null or cardinality(p_role_ids) = 0 then
    raise exception 'Roles: select at least one role.';   -- AppUser holds Role 1..*
  end if;
  select array_agg(role_name order by role_name) into v_roles
  from public.role where role_id = any (p_role_ids);
  if coalesce(cardinality(v_roles), 0) <> (select count(distinct x) from unnest(p_role_ids) x) then
    raise exception 'Roles: one of the selected roles does not exist.';
  end if;

  -- 1.4 Save account and roles
  insert into public.app_user (user_id, full_name, email, department_id, account_status)
  values (p_user_id, trim(p_full_name), v_email, p_department_id, 'active');

  insert into public.user_role (user_id, role_id, assigned_by)
  select p_user_id, r, auth.uid() from (select distinct unnest(p_role_ids) as r) x;

  -- one audit entry for the change (D9)
  perform public.write_audit('ACCOUNT_CREATED', 'app_user', p_user_id, null,
    jsonb_build_object('full_name', trim(p_full_name), 'email', v_email,
                       'department_id', p_department_id, 'roles', to_jsonb(v_roles)));
end;
$$;

-- ---------- 2. Update account (FR-03): name and department ----------
create or replace function public.admin_update_profile(
  p_user_id uuid, p_full_name text, p_department_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_old public.app_user;
begin
  if public.has_role('admin') is not true then
    raise exception 'Only an administrator can update accounts.';
  end if;
  select * into v_old from public.app_user where user_id = p_user_id for update;
  if not found then raise exception 'Profile not found.'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Full name is required.'; end if;
  if not exists (select 1 from public.department where department_id = p_department_id and is_active) then
    raise exception 'Department: choose an active department.';
  end if;

  if p_department_id is distinct from v_old.department_id then
    if p_user_id = auth.uid() then
      raise exception 'You cannot move your own account to another department.';  -- BR-02
    end if;
    -- a custodian must belong to the department of the assets she looks after
    if exists (select 1 from public.asset
               where custodian_id = p_user_id
                 and owning_department_id = v_old.department_id
                 and asset_state not in ('Donated', 'Recycled', 'Retired', 'Disposed', 'Cancelled')) then
      raise exception 'Department: this user is still custodian of assets in her current department. Reassign those assets first.';
    end if;
  end if;

  if trim(p_full_name) = v_old.full_name and p_department_id = v_old.department_id then
    return;  -- nothing changed, nothing to audit
  end if;

  update public.app_user
     set full_name = trim(p_full_name), department_id = p_department_id
   where user_id = p_user_id;

  perform public.write_audit('PROFILE_UPDATED', 'app_user', p_user_id,
    jsonb_build_object('full_name', v_old.full_name, 'department_id', v_old.department_id),
    jsonb_build_object('full_name', trim(p_full_name), 'department_id', p_department_id));
end;
$$;

-- ---------- 3. Remove role: never the last one (AppUser holds Role 1..*) ----------
create or replace function public.remove_user_role(p_user_role_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_row public.user_role;
begin
  if not public.has_role('admin') then
    raise exception 'Only an administrator can remove roles.';
  end if;
  select * into v_row from public.user_role where user_role_id = p_user_role_id;
  if not found then raise exception 'Role assignment not found.'; end if;
  if v_row.user_id = auth.uid() then raise exception 'You cannot change your own roles.'; end if;
  if (select count(*) from public.user_role where user_id = v_row.user_id) <= 1 then
    raise exception 'Every user must keep at least one role. Add another role first, or deactivate the account.';
  end if;

  delete from public.user_role where user_role_id = p_user_role_id;
  perform public.write_audit('ROLE_REMOVED', 'user_role', p_user_role_id, to_jsonb(v_row), null);
end;
$$;

revoke execute on function public.admin_create_account(uuid, text, uuid, uuid[]) from public, anon;
revoke execute on function public.admin_update_profile(uuid, text, uuid) from public, anon;
revoke execute on function public.remove_user_role(uuid) from public, anon;
grant  execute on function public.admin_create_account(uuid, text, uuid, uuid[]) to authenticated;
grant  execute on function public.admin_update_profile(uuid, text, uuid) to authenticated;
grant  execute on function public.remove_user_role(uuid) to authenticated;

commit;
