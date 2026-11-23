-- C5 coordinated correction: typed submission + one independently verified asset-facts record.
-- DEPENDENCIES: Shaikha weighted matching and Renad Nov 16 eligibility/transfer migrations.
-- IMPORTANT: apply only after Shaikha's matching adapter is reviewed against this contract.
-- This migration does NOT alter existing requests, reservations, stock, C8 triggers or history.
begin;

-- Fail early if dependencies are not installed.
do $$ begin
  if to_regprocedure('public.shaikha_submit_request(text,text,integer,text,text,text,text,date)') is null
     or to_regprocedure('public.shaikha_confirm_matching_requirements(uuid,jsonb,jsonb)') is null
     or to_regprocedure('public.shaikha_evidence_eligible(jsonb,jsonb)') is null then
    raise exception 'Missing C4/matching/C5 dependencies. Do not apply this migration yet.';
  end if;
end $$;

-- Normalization is deliberately small and deterministic. Do not equate unrelated equipment.
create function public.renad_normalize_item_type(p_type text)
returns text language sql immutable set search_path = '' as $$
  select case lower(btrim(p_type))
    when 'screen' then 'monitor'
    when 'display' then 'monitor'
    when 'computer monitor' then 'monitor'
    when 'monitor screen' then 'monitor'
    when 'laser printer' then 'printer'
    when 'inkjet printer' then 'printer'
    else lower(btrim(p_type))
  end;
$$;
revoke all on function public.renad_normalize_item_type(text) from public, anon, authenticated;

-- Reuse Shaikha's authorized request submission and its existing audit/history/C8 insert trigger.
-- A second resource_request row is NOT created. Item type is recorded in the same transaction.
-- Submission and mandatory requirements are saved atomically.
-- Failure rolls back the request, history and notification together.
create function public.renad_submit_typed_request(
  p_item_type text,
  p_category_name text,
  p_specifications text,
  p_quantity integer,
  p_preferred_condition text,
  p_purpose text,
  p_urgency text,
  p_preferred_location text,
  p_required_date date,
  p_mandatory jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request uuid;
  v_type text;
  v_requirements jsonb;
begin
  v_type := public.renad_normalize_item_type(p_item_type);

  if v_type is null or length(v_type) not between 1 and 80 then
    raise exception 'Enter a specific item type (1–80 characters).'
      using errcode = '22023';
  end if;

  if public.shaikha_validate_requirements(p_mandatory) is not true then
    raise exception
      'Invalid mandatory requirements. Use field, operator and value for each check.'
      using errcode = '22023';
  end if;

  -- Item type comes from its own field, not two competing inputs.
  if exists (
    select 1
    from jsonb_array_elements(p_mandatory) requirement
    where requirement->>'field' = 'item_type'
  ) then
    raise exception
      'Enter item type in the Item Type field, not in additional requirements.'
      using errcode = '22023';
  end if;

  v_requirements :=
    jsonb_build_array(
      jsonb_build_object(
        'field', 'item_type',
        'operator', 'eq',
        'value', v_type
      )
    ) || p_mandatory;

  if public.shaikha_validate_requirements(v_requirements) is not true then
    raise exception
      'Too many requirements. Allow at most 49 additional checks.'
      using errcode = '22023';
  end if;

  if p_required_date is not null
     and p_required_date <
       (statement_timestamp() at time zone 'UTC')::date then
    raise exception 'Required date cannot be in the past.'
      using errcode = '22023';
  end if;

  v_request := public.shaikha_submit_request(
    p_category_name,
    p_specifications,
    p_quantity,
    p_preferred_condition,
    p_purpose,
    p_urgency,
    p_preferred_location,
    p_required_date
  );

  perform public.shaikha_confirm_matching_requirements(
    v_request,
    v_requirements,
    '[]'::jsonb
  );

  return v_request;
end;
$$;

revoke all on function public.renad_submit_typed_request(
  text, text, text, integer, text, text, text, text, date, jsonb
) from public, anon, authenticated;

grant execute on function public.renad_submit_typed_request(
  text, text, text, integer, text, text, text, text, date, jsonb
) to authenticated;

-- One current asset-level facts record, NOT one per request/asset pair.
-- Direct table access is forbidden: all writes go through the authorized RPC below.
create table public.renad_asset_facts (
  asset_id uuid primary key references public.asset(asset_id) on delete cascade,
  asset_snapshot jsonb not null,
  evidence jsonb not null,
  reviewed_by uuid not null references public.app_user(user_id),
  source_reference text not null check (length(btrim(source_reference)) between 1 and 1000),
  reviewed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint renad_asset_facts_expiry check (expires_at > reviewed_at)
);
alter table public.renad_asset_facts enable row level security;
revoke all on public.renad_asset_facts from public, anon, authenticated;

-- Custodian/admin records actual facts; the server derives the actor and owning department.
-- Lock asset BEFORE updating facts; approval/release lock the same asset before rechecking.
create function public.renad_record_asset_facts(
  p_asset uuid, p_specifications jsonb, p_safety text,
  p_inspection_required boolean, p_inspection_result text,
  p_inspected_on date, p_inspection_valid_until date,
  p_earliest_receipt_date date, p_valid_until date, p_source text,
  p_campus_wide_arrival boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.asset;
  v_key text;
  v_value jsonb;
  v_spec jsonb;
  v_evidence jsonb;
  v_inspection jsonb;
  v_today date := (statement_timestamp() at time zone 'UTC')::date;
begin
  select * into a from public.asset where asset_id=p_asset for update;
  if not found then raise exception 'Asset not found.' using errcode='22023'; end if;
  if auth.uid() is null or not exists (
    select 1 from public.app_user u join public.department d on d.department_id=u.department_id
    join public.user_role ur on ur.user_id=u.user_id join public.role r on r.role_id=ur.role_id
    where u.user_id=auth.uid() and u.account_status='active' and d.is_active
      and (r.role_name='admin' or (r.role_name='custodian' and u.department_id=a.owning_department_id))
  ) then
    raise exception 'Only an active admin or the owning department custodian can verify asset facts.'
      using errcode='42501';
  end if;
  if jsonb_typeof(p_specifications) is distinct from 'object'
     or not (p_specifications ? 'item_type')
     or jsonb_typeof(p_specifications->'item_type') is distinct from 'string' then
    raise exception 'Enter verified flat specifications with item_type.' using errcode='22023';
  end if;
  v_spec := p_specifications;
  for v_key, v_value in select key,value from jsonb_each(v_spec) loop
    if v_key !~ '^[a-z][a-z0-9_]{0,63}$'
       or jsonb_typeof(v_value) not in ('string','number','boolean') then
      raise exception 'Specification keys must be lowercase and values flat strings/numbers/booleans.'
        using errcode='22023';
    end if;
  end loop;
  v_spec := jsonb_set(v_spec,'{item_type}',
    to_jsonb(public.renad_normalize_item_type(v_spec->>'item_type')));
  if length(v_spec->>'item_type') not between 1 and 80
     or p_safety is null or p_safety not in ('clear','restricted','unknown')
     or p_inspection_required is null
     or p_source is null or length(btrim(p_source)) not between 1 and 1000
     or p_valid_until is null or p_valid_until < v_today or p_valid_until > v_today+30 then
    raise exception 'Enter valid item type, safety, source and expiry within 30 days.' using errcode='22023';
  end if;
  if p_inspection_required then
    if p_inspection_result is null or p_inspection_result not in ('passed','failed','unknown') then
      raise exception 'Choose passed, failed or unknown inspection result.' using errcode='22023';
    end if;
    if p_inspection_result='passed' and
       (p_inspected_on is null or p_inspection_valid_until is null
        or p_inspected_on > v_today or p_inspection_valid_until < p_inspected_on) then
      raise exception 'A passed inspection requires real inspection and validity dates.' using errcode='22023';
    end if;
    v_inspection := jsonb_build_object('result',p_inspection_result,
      'inspectedOn',p_inspected_on,'validUntil',p_inspection_valid_until);
  else
    if p_inspection_result is not null and p_inspection_result <> 'unknown' then
      raise exception 'Do not record an inspection result when inspection is not required.' using errcode='22023';
    end if;
    v_inspection := 'null'::jsonb;
  end if;
  if p_earliest_receipt_date is not null and p_campus_wide_arrival is distinct from true then
    raise exception 'Arrival date requires verified campus-wide delivery evidence.' using errcode='22023';
  end if;
  if p_earliest_receipt_date is not null and p_earliest_receipt_date < v_today then
    raise exception 'Earliest verified receipt cannot be in the past.' using errcode='22023';
  end if;
  -- A single asset-level date can only represent a campus-wide delivery guarantee.
  -- Do NOT enter a destination-specific arrival date as reusable evidence.
  -- If arrival feasibility differs by department, leave it NULL (fail closed
  -- for deadline requests) until destination-scoped arrival evidence is added.
  v_evidence := jsonb_build_object(
    'specifications',v_spec,'safetyStatus',p_safety,
    'inspectionRequired',p_inspection_required,'inspection',v_inspection,
    'earliestReceiptDate',p_earliest_receipt_date
  );
  insert into public.renad_asset_facts(
    asset_id,asset_snapshot,evidence,reviewed_by,source_reference,reviewed_at,expires_at
  ) values (
    p_asset,public.shaikha_asset_snapshot(a),v_evidence,auth.uid(),btrim(p_source),
    statement_timestamp(),(p_valid_until+1)::timestamp at time zone 'UTC'
  ) on conflict(asset_id) do update set
    asset_snapshot=excluded.asset_snapshot,evidence=excluded.evidence,
    reviewed_by=excluded.reviewed_by,source_reference=excluded.source_reference,
    reviewed_at=excluded.reviewed_at,expires_at=excluded.expires_at;
  perform public.write_audit('ASSET_FACTS_VERIFIED','asset',p_asset,null,v_evidence,btrim(p_source));
end $$;
revoke all on function public.renad_record_asset_facts(uuid,jsonb,text,boolean,text,date,date,date,date,text,boolean)
  from public, anon, authenticated;
grant execute on function public.renad_record_asset_facts(uuid,jsonb,text,boolean,text,date,date,date,date,text,boolean)
  to authenticated;

-- Private adapter: return latest current, authorized facts, or NULL (fail closed).
-- Snapshot intentionally excludes changing stock/state but includes asset descriptive fields.
create function public.renad_reusable_asset_evidence(p_asset uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare a public.asset; f public.renad_asset_facts;
begin
  select * into a from public.asset where asset_id=p_asset;
  if not found then return null; end if;
  select * into f from public.renad_asset_facts where asset_id=p_asset;
  if not found or f.asset_snapshot is distinct from public.shaikha_asset_snapshot(a)
     or f.expires_at <= statement_timestamp() or f.reviewed_at > statement_timestamp() then
    return null;
  end if;
  if not exists (
    select 1 from public.app_user u join public.department d on d.department_id=u.department_id
    join public.user_role ur on ur.user_id=u.user_id join public.role r on r.role_id=ur.role_id
    where u.user_id=f.reviewed_by and u.account_status='active' and d.is_active
      and (r.role_name='admin' or (r.role_name='custodian' and u.department_id=a.owning_department_id))
  ) then return null; end if;
  return f.evidence;
end $$;
revoke all on function public.renad_reusable_asset_evidence(uuid)
  from public, anon, authenticated;

-- Same eligibility predicate for approver dropdown, approval/reservation and release.
create or replace function public.renad_eligibility_problem(
  p_request uuid,p_asset uuid,p_held boolean default false
) returns text language plpgsql stable security definer set search_path = '' as $$
declare
  q public.resource_request; a public.asset; rules public.shaikha_request_match_rules;
  evidence jsonb; packet jsonb; candidate jsonb; held integer := 0;
begin
  select * into q from public.resource_request where request_id=p_request;
  if not found then return 'Request not found.'; end if;
  select * into a from public.asset where asset_id=p_asset;
  if not found then return 'Asset not found.'; end if;
  if not exists(select 1 from public.app_user where user_id=q.submitted_by and account_status='active')
     or not exists(select 1 from public.department where department_id=q.requesting_department_id and is_active)
     or not exists(select 1 from public.department where department_id=a.owning_department_id and is_active) then
    return 'Requester and departments must be active.';
  end if;
  select * into rules from public.shaikha_request_match_rules
    where request_id=p_request and confirmed_by=q.submitted_by
      and request_snapshot=public.shaikha_request_snapshot(q);
  if not found then return 'Request has no current confirmed item type.'; end if;
  if not exists(select 1 from jsonb_array_elements(rules.mandatory_requirements) x
    where x->>'field'='item_type' and x->>'operator'='eq'
      and jsonb_typeof(x->'value')='string' and length(btrim(x->>'value'))>0) then
    return 'Request needs a specific item type.';
  end if;
  evidence := public.renad_reusable_asset_evidence(p_asset);
  if evidence is null then return 'Verified asset facts are missing, stale or expired.'; end if;
  if p_held then
    select coalesce(sum(reserved_quantity),0)::integer into held from public.reservation
      where request_id=p_request and asset_id=p_asset and reservation_status='Active'
        and expires_at>statement_timestamp();
    if held<>q.quantity or a.asset_state not in ('Available','Reserved','In Transfer') then
      return 'Approved hold is missing, expired or asset is restricted.';
    end if;
  end if;
  packet := jsonb_build_object(
    'contract_version','weighted-reusable-v2',
    'evidence_source','renad_reusable_asset_evidence',
    'category_id',q.requested_category_id,'quantity',q.quantity,
    'required_date',q.required_date,
    'assessment_date',(statement_timestamp() at time zone 'UTC')::date,
    'mandatory_requirements',rules.mandatory_requirements,
    'preferred_requirements',rules.preferred_requirements
  );
  candidate := jsonb_build_object(
    'category_id',a.category_id,'condition',a.condition,
    'is_published',case when p_held then true else a.is_published end,
    'asset_state',case when p_held then 'Available' else a.asset_state end,
    'available_quantity',case when p_held then held else a.available_quantity end,
    'evidence',evidence
  );
  if public.shaikha_evidence_eligible(packet,candidate) is not true then
    return 'Asset fails type, mandatory specifications, safety, inspection, date or stock requirements.';
  end if;
  return null;
end $$;
revoke all on function public.renad_eligibility_problem(uuid,uuid,boolean)
  from public, anon, authenticated;

-- Narrow authorized read API for the asset-facts form. No unrestricted facts-table SELECT.
create function public.renad_asset_facts_workspace()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.app_user u join public.department d on d.department_id=u.department_id
    join public.user_role ur on ur.user_id=u.user_id join public.role r on r.role_id=ur.role_id
    where u.user_id=auth.uid() and u.account_status='active' and d.is_active
      and r.role_name in ('admin','custodian')
  ) then raise exception 'Active admin/custodian required.' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'asset_id',a.asset_id,'name',a.name,'description',a.description,
    'condition',a.condition,'department_id',a.owning_department_id,
    'facts_current',public.renad_reusable_asset_evidence(a.asset_id) is not null
  ) order by a.name),'[]'::jsonb) into result
  from public.asset a where public.has_role('admin')
    or (public.has_role('custodian') and a.owning_department_id=public.current_department_id());
  return jsonb_build_object('assets',result);
end $$;
revoke all on function public.renad_asset_facts_workspace() from public, anon, authenticated;
grant execute on function public.renad_asset_facts_workspace() to authenticated;

-- The obsolete standalone item-type API allowed changes after approval.
-- New submission uses Shaikha's requirement writer instead.
-- That writer permits only Submitted/Under Review requests.
revoke all on function public.renad_confirm_item_type(uuid,text)
from public, anon, authenticated;

commit;
