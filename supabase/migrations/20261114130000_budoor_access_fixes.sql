-- =====================================================================
-- Budoor – access fixes after review (C1–C3)
-- Run ONCE, AFTER 20261114090000_budoor_access_and_assets.sql (do not rerun or edit that file).
--
--  1. Inactive or not-yet-provisioned users can read NOTHING (every read policy now needs an
--     active app_user profile).
--  2. Publishing needs admin, or a custodian of the asset's OWNING department.
--     Being the asset's custodian alone is no longer enough.
--  3. An asset's custodian must be an active user with the custodian role in the owning
--     department (no more picking any user).
--  4. list_custodians(): the register form only offers valid custodians.
--  5. Permission checks use IS NOT TRUE, so a NULL (missing department, empty custodian)
--     can never let an action through (review finding 3).
-- =====================================================================
begin;

-- ---------- 1. Active-profile check used by every read policy ----------
create or replace function public.is_active_user()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.app_user
                 where user_id = auth.uid() and account_status = 'active');
$$;

revoke execute on function public.is_active_user() from public, anon;
grant  execute on function public.is_active_user() to authenticated;

-- Recreate the read policies with the active check (writes were already function-only)
drop policy if exists department_read on public.department;
create policy department_read on public.department for select to authenticated
  using (public.is_active_user());

drop policy if exists role_read on public.role;
create policy role_read on public.role for select to authenticated
  using (public.is_active_user());

drop policy if exists category_read on public.asset_category;
create policy category_read on public.asset_category for select to authenticated
  using (public.is_active_user());

drop policy if exists app_user_read on public.app_user;
create policy app_user_read on public.app_user for select to authenticated using (
  public.is_active_user() and (
       user_id = auth.uid()
    or department_id = public.current_department_id()
    or public.has_role('admin') or public.has_role('approver')));

drop policy if exists user_role_read on public.user_role;
create policy user_role_read on public.user_role for select to authenticated using (
  public.is_active_user() and (user_id = auth.uid() or public.has_role('admin')));

drop policy if exists asset_read on public.asset;
create policy asset_read on public.asset for select to authenticated using (
  public.is_active_user() and (
       (is_published and asset_state = 'Available')
    or owning_department_id = public.current_department_id()
    or custodian_id = auth.uid()
    or public.has_role('admin') or public.has_role('approver')));
-- history_read follows asset_read; audit_read already needs an active admin/approver.

-- ---------- 2. Valid custodians for the register form ----------
create or replace function public.list_custodians()
returns table (user_id uuid, full_name text, department_id uuid)
language plpgsql stable security definer set search_path = public
as $$
begin
  if (public.has_role('admin') or public.has_role('custodian')) is not true then
    raise exception 'Only a custodian or administrator can list custodians.';
  end if;
  return query
    select u.user_id, u.full_name::text, u.department_id
    from public.app_user u
    join public.user_role ur on ur.user_id = u.user_id
    join public.role r       on r.role_id = ur.role_id and r.role_name = 'custodian'
    where u.account_status = 'active'
      and (public.has_role('admin') or u.department_id = public.current_department_id())
    order by u.full_name;
end;
$$;

revoke execute on function public.list_custodians() from public, anon;
grant  execute on function public.list_custodians() to authenticated;

-- ---------- 3. register_asset: custodian must be a custodian of the owning department ----------
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
  v_is_custodian boolean := public.has_role('custodian');
  -- no custodian chosen: a custodian registering is responsible; an admin may leave it empty
  v_custodian uuid := coalesce(p_custodian_id, case when v_is_custodian then auth.uid() end);
begin
  if (v_is_admin or v_is_custodian) is not true then
    raise exception 'Only a custodian or administrator can register assets.';
  end if;
  if v_is_admin is not true and p_owning_department_id is distinct from public.current_department_id() then
    raise exception 'You can only register assets for your own department.';
  end if;

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

  -- NEW: the custodian must be an active custodian of the owning department
  if v_custodian is not null and not exists (
      select 1 from public.app_user u
      join public.user_role ur on ur.user_id = u.user_id
      join public.role r       on r.role_id = ur.role_id and r.role_name = 'custodian'
      where u.user_id = v_custodian and u.account_status = 'active'
        and u.department_id = p_owning_department_id) then
    raise exception 'The custodian must be an active custodian of the owning department.';
  end if;

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

-- ---------- 4. publish_asset: admin, or custodian of the OWNING department ----------
create or replace function public.publish_asset(p_asset_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_asset public.asset;
begin
  select * into v_asset from public.asset where asset_id = p_asset_id for update;
  if not found then raise exception 'Asset not found.'; end if;

  -- CHANGED: custody alone is not enough; the publisher must belong to the owning department
  -- IS NOT TRUE: a NULL anywhere (no department, no custodian) counts as "not allowed"
  if (public.has_role('admin')
      or (public.has_role('custodian')
          and v_asset.owning_department_id = public.current_department_id())) is not true then
    raise exception 'Only a custodian of the owning department or an administrator can publish this asset.';
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

-- create or replace keeps the earlier grants; repeated here so the file stands on its own
revoke execute on function public.register_asset(text, text, uuid, int, date, numeric, uuid, uuid, text, text, text, numeric, date) from public, anon;
revoke execute on function public.publish_asset(uuid) from public, anon;
grant  execute on function public.register_asset(text, text, uuid, int, date, numeric, uuid, uuid, text, text, text, numeric, date) to authenticated;
grant  execute on function public.publish_asset(uuid) to authenticated;

commit;
