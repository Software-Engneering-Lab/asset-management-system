-- =====================================================================
-- 20261122130000_only_custodians_publish_assets.sql
-- Run AFTER 20261122120000_only_custodians_register_assets.sql. Apply once.
--
-- Replaces public.publish_asset (last defined in 20261114130000_budoor_access_fixes.sql)
-- so that the System Administrator ('admin') can no longer publish assets.
-- Phase 4–5 (role table §6.2, UC-03): publishing surplus is a business action
-- of the owning department; technical administration does not grant business
-- authority. An admin who really needs to publish must ALSO hold the
-- custodian role in the asset's owning department.
--
-- Everything else is exactly as in Budoor's fixes version: same checks,
-- same messages, same history and audit entries. Same name and parameter,
-- so the app code does not change and the existing grants stay in place.
-- =====================================================================
begin;

create or replace function public.publish_asset(p_asset_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_asset public.asset;
begin
  -- Lock the row so two people cannot change it at the same time
  select * into v_asset from public.asset where asset_id = p_asset_id for update;
  if not found then raise exception 'Asset not found.'; end if;

  -- CHANGED: admin removed. Only a custodian of the OWNING department may publish.
  -- IS NOT TRUE: a NULL anywhere (no department, no custodian) counts as "not allowed"
  if (public.has_role('custodian')
      and v_asset.owning_department_id = public.current_department_id()) is not true then
    raise exception 'Only an Asset Custodian of the owning department can publish this asset.';
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

commit;
