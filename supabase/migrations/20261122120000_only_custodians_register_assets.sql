-- =====================================================================
-- 20261122120000_only_custodians_register_assets.sql
-- Run AFTER 20261114130000_budoor_access_fixes.sql. Apply once.
--
-- Replaces public.register_asset (from 20261114090000_budoor_access_and_assets.sql)
-- so that it follows Phase 4–5 (UC-02, role table §6.2):
--
--   * ONLY an Asset Custodian ('custodian' role) can register assets.
--     The System Administrator ('admin') no longer can: technical
--     administration does not grant business authority. An admin who
--     really needs to register assets must ALSO be given the custodian role.
--   * Assets are registered for the custodian's OWN department only.
--   * Every asset has a custodian: by default the signed-in custodian;
--     if another one is chosen, she must be an active 'custodian' of the
--     same department.
--
-- Same function name, parameters and defaults as before, so the app code
-- does not change and existing grants stay in place.
-- =====================================================================
begin;

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
  v_id        uuid;
  v_my_dept   uuid := public.current_department_id();
  v_custodian uuid := coalesce(p_custodian_id, auth.uid());
begin
  -- Who may register (UC-02): Asset Custodian only
  if not public.has_role('custodian') then
    raise exception 'Only an Asset Custodian can register assets.';
  end if;
  -- For her own department only
  if p_owning_department_id is distinct from v_my_dept then
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

  -- Responsible custodian: active, holds the custodian role, same department
  if not exists (
    select 1
    from public.app_user u
    join public.user_role ur on ur.user_id = u.user_id
    join public.role r       on r.role_id  = ur.role_id
    where u.user_id        = v_custodian
      and u.account_status = 'active'
      and r.role_name      = 'custodian'
      and u.department_id  = p_owning_department_id) then
    raise exception 'The responsible custodian must be an active Asset Custodian in this department.';
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

commit;
