begin;

-- Shared by matching, approval, reservation and handover.
-- Explicitly validate each requirement without relying on
-- the previous checker's nested helper functions.
create or replace function public.shaikha_evidence_eligible(
  packet jsonb,
  candidate jsonb
)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  evidence jsonb;
  specifications jsonb;
  mandatory jsonb;
  preferred jsonb;
  rule jsonb;
  actual jsonb;
  expected jsonb;
  inspection jsonb;
  field_name text;
  comparison text;
  today date;
  required_on date;
  receipt_on date;
  inspected_on date;
  inspection_until date;
begin
  -- Matching and approval must use the coordinated contract.
  if packet->>'contract_version'
       is distinct from 'weighted-reusable-v2'
     or packet->>'evidence_source'
       is distinct from 'renad_reusable_asset_evidence' then
    return false;
  end if;

  mandatory := packet->'mandatory_requirements';
  preferred := packet->'preferred_requirements';
  evidence := candidate->'evidence';
  specifications := evidence->'specifications';

  if jsonb_typeof(mandatory) is distinct from 'array'
     or jsonb_typeof(preferred) is distinct from 'array'
     or jsonb_typeof(evidence) is distinct from 'object'
     or jsonb_typeof(specifications) is distinct from 'object' then
    return false;
  end if;

  if jsonb_array_length(mandatory) > 50
     or jsonb_array_length(preferred) > 50 then
    return false;
  end if;

  -- Validate both rule lists. Preferred rules affect scoring,
  -- but their failure does not make an asset ineligible.
  for rule in
    select value
    from jsonb_array_elements(mandatory || preferred)
  loop
    if jsonb_typeof(rule) is distinct from 'object' then
      return false;
    end if;

    field_name := rule->>'field';
    comparison := rule->>'operator';
    expected := rule->'value';

    if field_name is null
       or field_name !~ '^[a-z][a-z0-9_]{0,63}$'
       or comparison is null
       or comparison not in ('eq', 'gte', 'lte')
       or expected is null
       or jsonb_typeof(expected) not in (
         'string', 'number', 'boolean'
       ) then
      return false;
    end if;

    if comparison in ('gte', 'lte')
       and jsonb_typeof(expected) <> 'number' then
      return false;
    end if;

    if jsonb_typeof(expected) = 'string'
       and length(btrim(expected #>> '{}')) not between 1 and 1000 then
      return false;
    end if;
  end loop;

  -- Exactly one mandatory item type; never a preferred-only type.
  if (
    select count(*)
    from jsonb_array_elements(mandatory) r
    where r->>'field' = 'item_type'
  ) <> 1 then
    return false;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(mandatory) r
    where r->>'field' = 'item_type'
      and r->>'operator' = 'eq'
      and jsonb_typeof(r->'value') = 'string'
  ) or exists (
    select 1
    from jsonb_array_elements(preferred) r
    where r->>'field' = 'item_type'
  ) then
    return false;
  end if;

  -- Basic allocation checks.
  if packet->>'category_id' is null
     or candidate->>'category_id'
          is distinct from packet->>'category_id'
     or candidate->'is_published'
          is distinct from 'true'::jsonb
     or candidate->>'asset_state' is distinct from 'Available'
     or coalesce(candidate->>'condition', '') not in ('Good', 'Fair')
     or jsonb_typeof(packet->'quantity') is distinct from 'number'
     or jsonb_typeof(candidate->'available_quantity')
          is distinct from 'number' then
    return false;
  end if;

  if (packet->>'quantity')::numeric < 1
     or (packet->>'quantity')::numeric <>
          trunc((packet->>'quantity')::numeric)
     or (candidate->>'available_quantity')::numeric <
          (packet->>'quantity')::numeric then
    return false;
  end if;

  -- Unknown safety must not be treated as verified safe.
  if evidence->>'safetyStatus' is distinct from 'clear'
     or jsonb_typeof(evidence->'inspectionRequired')
          is distinct from 'boolean' then
    return false;
  end if;

  -- Facts must contain simple, comparable values.
  if exists (
    select 1
    from jsonb_each(specifications) s
    where jsonb_typeof(s.value) not in (
      'string', 'number', 'boolean', 'null'
    )
  ) then
    return false;
  end if;

  if packet->>'assessment_date' is null then
    return false;
  end if;

  today := (packet->>'assessment_date')::date;

  -- A request without a deadline does not need an arrival date.
  if packet->>'required_date' is not null then
    required_on := (packet->>'required_date')::date;

    if evidence->>'earliestReceiptDate' is null then
      return false;
    end if;

    receipt_on := (evidence->>'earliestReceiptDate')::date;

    if required_on < today or receipt_on > required_on then
      return false;
    end if;
  end if;

  -- No inspection is required when explicitly recorded as false.
  if (evidence->>'inspectionRequired')::boolean then
    inspection := evidence->'inspection';

    if jsonb_typeof(inspection) is distinct from 'object'
       or inspection->>'result' is distinct from 'passed'
       or inspection->>'inspectedOn' is null
       or inspection->>'validUntil' is null then
      return false;
    end if;

    inspected_on := (inspection->>'inspectedOn')::date;
    inspection_until := (inspection->>'validUntil')::date;

    if inspected_on > today
       or inspection_until < inspected_on
       or inspection_until < greatest(
         today, coalesce(required_on, today)
       ) then
      return false;
    end if;
  end if;

  -- Every mandatory specification must match an actual asset fact.
  for rule in
    select value from jsonb_array_elements(mandatory)
  loop
    field_name := rule->>'field';
    comparison := rule->>'operator';
    expected := rule->'value';
    actual := specifications->field_name;

    if actual is null
       or actual = 'null'::jsonb
       or jsonb_typeof(actual)
            is distinct from jsonb_typeof(expected) then
      return false;
    end if;

    if comparison = 'eq' then
      if jsonb_typeof(expected) = 'string' then
        if lower(btrim(actual #>> '{}'))
             is distinct from lower(btrim(expected #>> '{}')) then
          return false;
        end if;
      elsif actual is distinct from expected then
        return false;
      end if;

    elsif comparison = 'gte' then
      if (actual #>> '{}')::numeric <
           (expected #>> '{}')::numeric then
        return false;
      end if;

    elsif comparison = 'lte' then
      if (actual #>> '{}')::numeric >
           (expected #>> '{}')::numeric then
        return false;
      end if;
    end if;
  end loop;

  return true;

exception
  when invalid_text_representation
    or invalid_datetime_format
    or datetime_field_overflow
    or numeric_value_out_of_range then
    return false;
end;
$$;

-- Keep this an internal helper, not a browser-callable API.
revoke all on function
  public.shaikha_evidence_eligible(jsonb,jsonb)
from public, anon, authenticated, service_role;

commit;