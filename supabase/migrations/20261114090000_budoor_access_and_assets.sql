-- =====================================================================
-- Budoor – C1 (profiles, roles, scoped RLS), C2 (departments, assets), C3 (publish, search)
-- Run AFTER 20261112000100_shared_foundation.sql and 20261113000100_foundation_contract.sql.
-- Apply once. Later changes go in a NEW migration file.
--
-- What this adds:
--  1. Helper functions every feature can use: has_role(), current_department_id(), write_audit()
--  2. SELECT grants + scoped RLS policies for the tables C1–C3 own or read
--  3. Trusted operations (SECURITY DEFINER functions) for profiles, roles, assets and publishing
--
-- Notes for the team:
--  * Nobody gets INSERT/UPDATE/DELETE on asset, app_user or user_role. Changes go through
--    functions that check the role themselves (Renad's reserve/release/receive should do the same).
--  * Self sign-up creates only an Auth user. It gets NO profile and NO role until an admin
--    provisions it (provision_profile + assign_user_role).
-- =====================================================================
begin;

-- ---------- 1. Helper functions ----------

-- Does the signed-in user hold this role with an active profile?
create or replace function public.has_role(p_role text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.user_role ur
    join public.role r     on r.role_id = ur.role_id
    join public.app_user u on u.user_id = ur.user_id
    where ur.user_id = auth.uid()
      and r.role_name = p_role
      and u.account_status = 'active');
$$;

-- Department of the signed-in user (null if no active profile)
create or replace function public.current_department_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select department_id from public.app_user
  where user_id = auth.uid() and account_status = 'active';
$$;

-- Append-only audit entry (FR-05, FR-34). Only callable from other trusted functions.
create or replace function public.write_audit(
  p_action text, p_record_type text, p_record_id uuid,
  p_previous jsonb default null, p_new jsonb default null, p_reason text default null)
returns void
language sql security definer set search_path = public
as $$
  insert into public.audit_log (actor_id, action, record_type, record_id, previous_value, new_value, reason)
  values (auth.uid(), p_action, p_record_type, p_record_id, p_previous, p_new, p_reason);
$$;

-- ---------- 2. Read access (grants + scoped policies) ----------

grant select on public.department, public.role, public.app_user, public.user_role,
                public.asset_category, public.asset, public.asset_history_event, public.audit_log
  to authenticated;
grant insert, update on public.department to authenticated;   -- admin only, see policy

-- department: every signed-in user reads; only admin writes (FR-04)
create policy department_read on public.department for select to authenticated using (true);
create policy department_admin_insert on public.department for insert to authenticated
  with check (public.has_role('admin'));
create policy department_admin_update on public.department for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

create policy role_read on public.role for select to authenticated using (true);

-- app_user: own profile, same department, or admin/approver (names for custodian lists and reviews)
create policy app_user_read on public.app_user for select to authenticated using (
     user_id = auth.uid()
  or department_id = public.current_department_id()
  or public.has_role('admin') or public.has_role('approver'));

-- user_role: own roles or admin
create policy user_role_read on public.user_role for select to authenticated
  using (user_id = auth.uid() or public.has_role('admin'));

create policy category_read on public.asset_category for select to authenticated using (true);

-- asset: published+available for everyone with a profile; the rest for own department,
-- own custody, approver or admin
create policy asset_read on public.asset for select to authenticated using (
     (is_published and asset_state = 'Available' and public.current_department_id() is not null)
  or owning_department_id = public.current_department_id()
  or custodian_id = auth.uid()
  or public.has_role('admin') or public.has_role('approver'));

-- history: visible when its asset is visible
create policy history_read on public.asset_history_event for select to authenticated
  using (exists (select 1 from public.asset a where a.asset_id = asset_history_event.asset_id));

-- audit log: admin and approver only; no one can change or delete entries (NFR-SE06)
create policy audit_read on public.audit_log for select to authenticated
  using (public.has_role('admin') or public.has_role('approver'));

-- ---------- 3. Department audit trigger (FR-05) ----------

create or replace function public.audit_department_change()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;   -- SQL Editor / seed scripts
  perform public.write_audit(
    case when tg_op = 'INSERT' then 'DEPARTMENT_CREATED' else 'DEPARTMENT_UPDATED' end,
    'department', new.department_id,
    case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end;
$$;

create trigger trg_audit_department after insert or update on public.department
  for each row execute function public.audit_department_change();

-- ---------- 4. Profiles and roles (C1: FR-02, FR-03, FR-05) ----------

-- Signed-up Auth users that have no profile yet (admin screen)
create or replace function public.list_unprovisioned_users()
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only an administrator can view new accounts.';
  end if;
  return query
    select au.id, au.email::text, au.created_at
    from auth.users au
    where not exists (select 1 from public.app_user u where u.user_id = au.id)
    order by au.created_at desc;
end;
$$;

-- Link an Auth user to a profile and department (no role yet)
create or replace function public.provision_profile(p_user_id uuid, p_full_name text, p_department_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_email text;
begin
  if not public.has_role('admin') then
    raise exception 'Only an administrator can create profiles.';
  end if;
  select email into v_email from auth.users where id = p_user_id;
  if v_email is null then raise exception 'Login account not found.'; end if;
  if exists (select 1 from public.app_user where user_id = p_user_id) then
    raise exception 'This account already has a profile.';
  end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Full name is required.'; end if;
  if not exists (select 1 from public.department where department_id = p_department_id and is_active) then
    raise exception 'Choose an active department.';
  end if;

  insert into public.app_user (user_id, full_name, email, department_id, account_status)
  values (p_user_id, trim(p_full_name), v_email, p_department_id, 'active');

  perform public.write_audit('PROFILE_CREATED', 'app_user', p_user_id, null,
    jsonb_build_object('full_name', trim(p_full_name), 'email', v_email, 'department_id', p_department_id));
end;
$$;

-- Activate / deactivate an account (FR-03). Inactive users cannot sign in to the app.
create or replace function public.set_account_status(p_user_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_old text;
begin
  if not public.has_role('admin') then
    raise exception 'Only an administrator can change account status.';
  end if;
  if p_user_id = auth.uid() then raise exception 'You cannot change your own account status.'; end if;
  if p_status not in ('active', 'inactive') then raise exception 'Status must be active or inactive.'; end if;
  select account_status into v_old from public.app_user where user_id = p_user_id;
  if v_old is null then raise exception 'Profile not found.'; end if;

  update public.app_user set account_status = p_status where user_id = p_user_id;
  perform public.write_audit('ACCOUNT_STATUS_CHANGED', 'app_user', p_user_id,
    jsonb_build_object('account_status', v_old), jsonb_build_object('account_status', p_status));
end;
$$;

create or replace function public.assign_user_role(p_user_id uuid, p_role_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.has_role('admin') then
    raise exception 'Only an administrator can assign roles.';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own roles.';   -- BR-02: no self-granted authority
  end if;
  if not exists (select 1 from public.app_user where user_id = p_user_id) then
    raise exception 'Create the profile before assigning a role.';
  end if;
  if exists (select 1 from public.user_role where user_id = p_user_id and role_id = p_role_id) then
    raise exception 'The user already has this role.';
  end if;

  insert into public.user_role (user_id, role_id, assigned_by)
  values (p_user_id, p_role_id, auth.uid()) returning user_role_id into v_id;

  perform public.write_audit('ROLE_ASSIGNED', 'user_role', v_id, null,
    jsonb_build_object('user_id', p_user_id,
                       'role', (select role_name from public.role where role_id = p_role_id)));
end;
$$;

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

  delete from public.user_role where user_role_id = p_user_role_id;
  perform public.write_audit('ROLE_REMOVED', 'user_role', p_user_role_id, to_jsonb(v_row), null);
end;
$$;

-- ---------- 5. Register asset (C2: FR-06, FR-07, FR-09) ----------

create or replace function public.register_asset(
  p_name text, p_description text, p_category_id uuid, p_quantity int,
  p_purchase_date date, p_estimated_value numeric, p_owning_department_id uuid,
  p_custodian_id uuid, p_location text, p_condition text,
  p_material_type text default null, p_weight_kg numeric default null,
  p_expected_end_of_life date default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_is_admin boolean := public.has_role('admin');
  v_custodian uuid := coalesce(p_custodian_id, auth.uid());
begin
  if not (v_is_admin or public.has_role('custodian')) then
    raise exception 'Only a custodian or administrator can register assets.';
  end if;
  if not v_is_admin and p_owning_department_id is distinct from public.current_department_id() then
    raise exception 'You can only register assets for your own department.';
  end if;

  -- Same checks as the server form, so the database is never left wrong (FR-09)
  if coalesce(trim(p_name), '') = ''        then raise exception 'Name is required.'; end if;
  if coalesce(trim(p_description), '') = '' then raise exception 'Description is required.'; end if;
  if coalesce(trim(p_location), '') = ''    then raise exception 'Location is required.'; end if;
  if p_quantity is null or p_quantity < 1   then raise exception 'Quantity must be at least 1.'; end if;
  if p_estimated_value is null or p_estimated_value < 0 then
    raise exception 'Estimated value must be 0 or more.'; end if;
  if p_purchase_date is null or p_purchase_date > current_date then
    raise exception 'Purchase date is required and cannot be in the future.'; end if;
  if p_condition is null or p_condition not in ('Good', 'Fair', 'Poor') then
    raise exception 'Condition must be Good, Fair or Poor.'; end if;
  if p_weight_kg is not null and p_weight_kg < 0 then raise exception 'Weight must be 0 or more.'; end if;
  if not exists (select 1 from public.asset_category where category_id = p_category_id) then
    raise exception 'Category does not exist.'; end if;
  if not exists (select 1 from public.department where department_id = p_owning_department_id and is_active) then
    raise exception 'Department does not exist or is inactive.'; end if;
  if not exists (select 1 from public.app_user where user_id = v_custodian and account_status = 'active') then
    raise exception 'Custodian is not an active user.'; end if;

  insert into public.asset (name, description, category_id, quantity, available_quantity,
                            purchase_date, estimated_value, owning_department_id, custodian_id,
                            location, condition, asset_state, is_published,
                            material_type, weight_kg, expected_end_of_life)
  values (trim(p_name), trim(p_description), p_category_id, p_quantity, p_quantity,
          p_purchase_date, p_estimated_value, p_owning_department_id, v_custodian,
          trim(p_location), p_condition, 'Registered', false,
          nullif(trim(p_material_type), ''), p_weight_kg, p_expected_end_of_life)
  returning asset_id into v_id;

  insert into public.asset_history_event (asset_id, event_type, previous_state, new_state, details, performed_by)
  values (v_id, 'REGISTERED', null, 'Registered', 'Asset registered with quantity ' || p_quantity, auth.uid());

  perform public.write_audit('ASSET_REGISTERED', 'asset', v_id, null,
    (select to_jsonb(a) from public.asset a where a.asset_id = v_id));
  return v_id;
end;
$$;

-- ---------- 6. Publish surplus asset (C3: FR-10, NFR-SA01) ----------

create or replace function public.publish_asset(p_asset_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_asset public.asset;
begin
  -- Lock the row so two people cannot change it at the same time
  select * into v_asset from public.asset where asset_id = p_asset_id for update;
  if not found then raise exception 'Asset not found.'; end if;

  if not (public.has_role('admin')
       or (public.has_role('custodian')
           and (v_asset.custodian_id = auth.uid()
                or v_asset.owning_department_id = public.current_department_id()))) then
    raise exception 'You do not have permission to publish this asset.';
  end if;

  if v_asset.asset_state <> 'Registered' then
    raise exception 'Only Registered assets can be published (current state: %).', v_asset.asset_state;
  end if;
  if v_asset.condition not in ('Good', 'Fair') then
    raise exception 'Publication blocked: condition "%" is not suitable for reuse. Record an inspection or repair first.', v_asset.condition;
  end if;
  if v_asset.available_quantity < 1 then
    raise exception 'Publication blocked: no available quantity.';
  end if;
  if coalesce(trim(v_asset.description), '') = '' or coalesce(trim(v_asset.location), '') = '' then
    raise exception 'Publication blocked: required asset information is incomplete.';
  end if;

  update public.asset set asset_state = 'Available', is_published = true where asset_id = p_asset_id;

  insert into public.asset_history_event (asset_id, event_type, previous_state, new_state, details, performed_by)
  values (p_asset_id, 'PUBLISHED', 'Registered', 'Available', 'Published as surplus for internal exchange', auth.uid());

  perform public.write_audit('ASSET_PUBLISHED', 'asset', p_asset_id,
    jsonb_build_object('asset_state', 'Registered', 'is_published', false),
    jsonb_build_object('asset_state', 'Available',  'is_published', true));
end;
$$;

-- ---------- 7. Who may call what ----------
revoke execute on function public.write_audit(text, text, uuid, jsonb, jsonb, text) from public, anon, authenticated;
revoke execute on function public.audit_department_change() from public, anon, authenticated;

revoke execute on function public.list_unprovisioned_users() from public, anon;
revoke execute on function public.provision_profile(uuid, text, uuid) from public, anon;
revoke execute on function public.set_account_status(uuid, text) from public, anon;
revoke execute on function public.assign_user_role(uuid, uuid) from public, anon;
revoke execute on function public.remove_user_role(uuid) from public, anon;
revoke execute on function public.register_asset(text, text, uuid, int, date, numeric, uuid, uuid, text, text, text, numeric, date) from public, anon;
revoke execute on function public.publish_asset(uuid) from public, anon;

grant execute on function public.list_unprovisioned_users() to authenticated;
grant execute on function public.provision_profile(uuid, text, uuid) to authenticated;
grant execute on function public.set_account_status(uuid, text) to authenticated;
grant execute on function public.assign_user_role(uuid, uuid) to authenticated;
grant execute on function public.remove_user_role(uuid) to authenticated;
grant execute on function public.register_asset(text, text, uuid, int, date, numeric, uuid, uuid, text, text, text, numeric, date) to authenticated;
grant execute on function public.publish_asset(uuid) to authenticated;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.current_department_id() to authenticated;

commit;
