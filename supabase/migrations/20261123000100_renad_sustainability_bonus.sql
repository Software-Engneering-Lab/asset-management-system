begin;

-- Staff access: active admin/approver, or active custodian.
create function public.renad_sustainability_access()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.app_user u
    join public.department d on d.department_id = u.department_id
    join public.user_role ur on ur.user_id = u.user_id
    join public.role r on r.role_id = ur.role_id
    where u.user_id = auth.uid()
      and u.account_status = 'active'
      and d.is_active
      and r.role_name in ('admin', 'approver', 'custodian')
  ) then
    raise exception 'Active authorized staff account required.'
      using errcode = '42501';
  end if;
end;
$$;


-- Admins/approvers can review all assets.
-- Custodians are restricted to their own department.
create function public.renad_sustainability_asset_allowed(p_asset uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.asset a
    where a.asset_id = p_asset
      and (
        public.has_role('admin')
        or public.has_role('approver')
        or (
          public.has_role('custodian')
          and a.owning_department_id = public.current_department_id()
        )
      )
  );
$$;


-- C7: figures come from completed transfer records.
-- Repeated transfers count as separate movements, not unique reused units.
create function public.renad_sustainability_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  metrics jsonb;
  assets jsonb;
  records jsonb;
  reviews jsonb;
begin
  perform public.renad_sustainability_access();

  with visible as (
    select t.*, a.weight_kg
    from public.transfer t
    join public.asset a on a.asset_id = t.asset_id
    where t.transfer_status = 'Completed'
      and t.received_at is not null
      and (
        public.has_role('admin')
        or public.has_role('approver')
        or (
          public.has_role('custodian')
          and public.current_department_id() in (
            t.sending_department_id,
            t.receiving_department_id
          )
        )
      )
  )
  select jsonb_build_object(
    'completed_transfers', count(*),

    'unit_movements',
      coalesce(sum(received_quantity), 0),

    'missing_received_quantities',
      count(*) filter (where received_quantity is null),

    'known_transferred_mass_kg',
      case
        when count(*) = 0 then 0
        else sum(received_quantity * weight_kg)
      end,

    'missing_mass_records',
      count(*) filter (
        where weight_kg is null or received_quantity is null
      ),

    'recorded_transfer_cost_aed',
      case
        when count(*) = 0 then 0
        else sum(transfer_cost)
      end,

    'missing_cost_records',
      count(*) filter (where transfer_cost is null)
  )
  into metrics
  from visible;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', a.asset_id,
        'name', a.name,
        'condition', a.condition,
        'state', a.asset_state
      )
      order by a.name, a.asset_id
    ),
    '[]'::jsonb
  )
  into assets
  from public.asset a
  where a.quantity > 0
    and public.renad_sustainability_asset_allowed(a.asset_id);

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.received_at desc),
    '[]'::jsonb
  )
  into records
  from (
    select
      t.transfer_id,
      t.asset_id,
      a.name,
      t.received_quantity,
      t.transfer_cost,
      t.received_at
    from public.transfer t
    join public.asset a on a.asset_id = t.asset_id
    where t.transfer_status = 'Completed'
      and t.received_at is not null
      and (
        public.has_role('admin')
        or public.has_role('approver')
        or (
          public.has_role('custodian')
          and public.current_department_id() in (
            t.sending_department_id,
            t.receiving_department_id
          )
        )
      )
    order by t.received_at desc, t.transfer_id
    limit 100
  ) x;

  -- Human decisions are retained in the existing audit log.
  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.occurred_at desc),
    '[]'::jsonb
  )
  into reviews
  from (
    select
      l.audit_id,
      a.name,
      u.full_name as reviewer,
      l.new_value->>'chosen_action' as chosen_action,
      l.reason,
      l.occurred_at
    from public.audit_log l
    join public.asset a on a.asset_id = l.record_id
    join public.app_user u on u.user_id = l.actor_id
    where l.action = 'SUSTAINABILITY_REVIEW'
      and l.record_type = 'asset'
      and public.renad_sustainability_asset_allowed(a.asset_id)
    order by l.occurred_at desc, l.audit_id
    limit 50
  ) x;

  return jsonb_build_object(
    'scope',
      case
        when public.has_role('admin') or public.has_role('approver')
          then 'University-wide'
        else 'Transfers involving your department'
      end,
    'period', 'All recorded time',
    'metrics', metrics,
    'assets', assets,
    'records', records,
    'reviews', reviews
  );
end;
$$;


-- AI3 receives only authorized, relevant asset information.
-- Calculated quantities remain database-owned.
create function public.renad_sustainability_context(p_asset uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.asset;
  evidence jsonb;
begin
  perform public.renad_sustainability_access();

  if not public.renad_sustainability_asset_allowed(p_asset) then
    raise exception 'Asset unavailable or outside your permitted scope.'
      using errcode = '42501';
  end if;

  select * into strict a
  from public.asset
  where asset_id = p_asset;

  -- Uses the installed reusable-facts provider.
  evidence := public.renad_reusable_asset_evidence(p_asset);

  return jsonb_build_object(
    'asset_id', a.asset_id,
    'name', a.name,
    'description', a.description,
    'condition', a.condition,
    'state', a.asset_state,
    'quantity', a.quantity,
    'available_quantity', a.available_quantity,
    'material_type', a.material_type,
    'unit_weight_kg', a.weight_kg,

    'known_available_mass_kg',
      case
        when a.weight_kg is null then null
        else a.available_quantity * a.weight_kg
      end,

    'mass_formula', 'available_quantity × recorded unit weight_kg',
    'mass_source', 'public.asset',

    'verified_facts', evidence,

    'avoided_purchase_cost_aed', null,
    'carbon_reduction_kg_co2e', null,
    'missing_impact_inputs',
      'No documented avoided-purchase baseline or applicable emission factor is supplied.'
  );
end;
$$;


-- Save a human-selected plan, not an operational approval.
-- No asset state, ownership, quantity or reservation is changed.
create function public.renad_record_sustainability_review(
  p_asset uuid,
  p_action text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  result uuid;
  snapshot jsonb;
begin
  perform public.renad_sustainability_access();

  perform 1
  from public.asset
  where asset_id = p_asset
  for update;

  if not found
     or not public.renad_sustainability_asset_allowed(p_asset) then
    raise exception 'Asset unavailable or outside your permitted scope.'
      using errcode = '42501';
  end if;

  if p_action is null
     or p_action not in (
       'reuse', 'repair', 'donation', 'recycling', 'disposal', 'defer'
     )
     or p_reason is null
     or length(btrim(p_reason)) not between 1 and 2000 then
    raise exception 'Select a plan and provide a reason (1–2,000 characters).'
      using errcode = '22023';
  end if;

  snapshot := public.renad_sustainability_context(p_asset);

  insert into public.audit_log (
    actor_id,
    action,
    record_type,
    record_id,
    new_value,
    reason
  )
  values (
    auth.uid(),
    'SUSTAINABILITY_REVIEW',
    'asset',
    p_asset,
    jsonb_build_object(
      'chosen_action', p_action,
      'asset_snapshot', snapshot,
      'operational_approval', false
    ),
    btrim(p_reason)
  )
  returning audit_id into result;

  return result;
end;
$$;


revoke all on function
  public.renad_sustainability_access(),
  public.renad_sustainability_asset_allowed(uuid),
  public.renad_sustainability_workspace(),
  public.renad_sustainability_context(uuid),
  public.renad_record_sustainability_review(uuid,text,text)
from public, anon, authenticated;

grant execute on function
  public.renad_sustainability_workspace(),
  public.renad_sustainability_context(uuid),
  public.renad_record_sustainability_review(uuid,text,text)
to authenticated;

commit;