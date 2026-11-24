-- Fix: shaikha_evidence_eligible always returned false.
-- The query alias "x" clashed with the PL/pgSQL variable "x" ("column reference x is ambiguous");
-- the function's exception handler turned that error into FALSE, so no asset was ever eligible
-- for approval/reservation. Only the alias is renamed (x -> pr); the rules are unchanged.
-- New migration on purpose: applied migrations are never edited.
CREATE OR REPLACE FUNCTION public.shaikha_evidence_eligible(packet jsonb, candidate jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare e jsonb:=candidate->'evidence'; rule jsonb; x jsonb; today date;
 required_on date; inspected date; until_on date; receipt date;
begin
 if packet->>'contract_version' is distinct from 'weighted-reusable-v2' or
 packet->>'evidence_source' is distinct from 'renad_reusable_asset_evidence' or
 public.shaikha_mandatory_item_type(packet->'mandatory_requirements') is null or
 exists(select 1 from jsonb_array_elements(packet->'preferred_requirements') pr where pr->>'field'='item_type') or
 not public.shaikha_validate_requirements(packet->'mandatory_requirements') or
 not public.shaikha_validate_requirements(packet->'preferred_requirements') then return false; end if;
 if jsonb_typeof(e) is distinct from 'object' or jsonb_typeof(e->'specifications') is distinct from 'object'
 or e->>'safetyStatus' is distinct from 'clear' or jsonb_typeof(e->'inspectionRequired') is distinct from 'boolean' then return false; end if;
 if candidate->>'category_id' is distinct from packet->>'category_id' or candidate->>'is_published'<>'true'
 or candidate->>'asset_state'<>'Available' or candidate->>'condition' not in ('Good','Fair')
 or (candidate->>'available_quantity')::integer<(packet->>'quantity')::integer then return false; end if;
 for x in select value from jsonb_each(e->'specifications') loop
  if jsonb_typeof(x) not in ('null','number','boolean','string') then return false; end if;
 end loop;
 if not(e ? 'earliestReceiptDate') or jsonb_typeof(e->'earliestReceiptDate') not in ('null','string') then return false; end if;
 today:=public.shaikha_date(packet->>'assessment_date'); if today is null then return false; end if;
 if packet->>'required_date' is not null then
  required_on:=public.shaikha_date(packet->>'required_date'); receipt:=public.shaikha_date(e->>'earliestReceiptDate');
  if required_on is null
    or receipt is null
    or required_on < today
    or receipt > required_on then
    return false;
  end if;
 end if;
 -- Validate inspection shape even when an inspection is not required.
 if e->'inspection' is not null and e->'inspection'<>'null' then
  if jsonb_typeof(e->'inspection')<>'object' or coalesce(e#>>'{inspection,result}','') not in ('passed','failed','unknown')
  or jsonb_typeof(e#>'{inspection,inspectedOn}') is distinct from 'string'
  or jsonb_typeof(e#>'{inspection,validUntil}') is distinct from 'string' then return false; end if;
 end if;
 if (e->>'inspectionRequired')::boolean then
  inspected:=public.shaikha_date(e#>>'{inspection,inspectedOn}'); until_on:=public.shaikha_date(e#>>'{inspection,validUntil}');
  if e#>>'{inspection,result}' is distinct from 'passed' or inspected is null or until_on is null
  or inspected>today or until_on<greatest(today,coalesce(required_on,today)) or until_on<inspected then return false; end if;
 end if;
 for rule in select value from jsonb_array_elements(packet->'mandatory_requirements') loop
  if not public.shaikha_spec_satisfies(e->'specifications'->(rule->>'field'),rule) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $function$;

notify pgrst, 'reload schema';
