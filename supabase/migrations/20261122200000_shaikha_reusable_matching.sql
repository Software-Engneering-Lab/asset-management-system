-- PROPOSED AI2 adapter. REVIEW ONLY: DO NOT APPLY independently.
-- Coordinate with Renad's reusable facts provider, typed submission and parent
-- asset-row evidence locking. No SQL has been executed by preparing this file.
-- Never rerun prior migrations. This file does not touch the C8 trigger, create
-- requests/history/notices, change stock or replace Renad's workflow functions.
begin;

do $$
declare provider regprocedure := to_regprocedure('public.renad_reusable_asset_evidence(uuid)');
begin
 if provider is null then raise exception 'Requires coordinated renad_reusable_asset_evidence(uuid) provider first'; end if;
 if not exists(select 1 from pg_proc where oid=provider::oid and prorettype='jsonb'::regtype) then
  raise exception 'Reusable asset evidence provider must return jsonb';
 end if;
 if to_regprocedure('public.shaikha_save_weighted_matches(uuid,uuid,uuid,text,text,jsonb,jsonb)') is null then
  raise exception 'Requires already-installed weighted matching correction; do not rerun it';
 end if;
end $$;

create function public.shaikha_matching_item_type(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(public.renad_normalize_item_type(p), '');
$$;

create function public.shaikha_mandatory_item_type(p jsonb) returns text
language plpgsql immutable set search_path='' as $$
declare x jsonb; n integer; result text;
begin
 if not public.shaikha_validate_requirements(p) then return null; end if;
 select count(*) into n from jsonb_array_elements(p) rule where rule->>'field'='item_type';
 if n<>1 then return null; end if;
 select rule into x from jsonb_array_elements(p) rule where rule->>'field'='item_type';
 if x->>'operator' is distinct from 'eq' or jsonb_typeof(x->'value') is distinct from 'string' then return null; end if;
 result:=public.shaikha_matching_item_type(x->>'value');
 if result is null or length(result)>1000 then return null; end if;
 return result;
end $$;

-- Whitelist precisely Renad's five fields. No old request-pair evidence, asset
-- names, AI guesses or optional score/cost values are a fallback verification.
create function public.shaikha_reusable_evidence(p jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare x jsonb; specs jsonb; item_type text;
begin
 if jsonb_typeof(p) is distinct from 'object' or jsonb_typeof(p->'specifications') is distinct from 'object'
 or jsonb_typeof(p->'safetyStatus') is distinct from 'string' or p->>'safetyStatus' not in ('clear','restricted','unknown')
 or jsonb_typeof(p->'inspectionRequired') is distinct from 'boolean'
 or not(p ? 'inspection') or not(p ? 'earliestReceiptDate')
 or jsonb_typeof(p->'earliestReceiptDate') not in ('null','string') then return null; end if;
 specs:=p->'specifications';
 for x in select value from jsonb_each(specs) loop
  if jsonb_typeof(x) not in ('null','number','boolean','string') then return null; end if;
 end loop;
 if specs ? 'item_type' then
  if jsonb_typeof(specs->'item_type') is distinct from 'string' then return null; end if;
  item_type:=public.shaikha_matching_item_type(specs->>'item_type');
  if item_type is null or length(item_type)>1000 then return null; end if;
  specs:=jsonb_set(specs,'{item_type}',to_jsonb(item_type));
 end if;
 x:=p->'inspection';
 if x<>'null'::jsonb and (jsonb_typeof(x) is distinct from 'object'
  or jsonb_typeof(x->'result') is distinct from 'string' or x->>'result' not in ('passed','failed','unknown')
  or jsonb_typeof(x->'inspectedOn') is distinct from 'string' or jsonb_typeof(x->'validUntil') is distinct from 'string') then return null; end if;
 return jsonb_build_object('specifications',specs,'safetyStatus',p->'safetyStatus',
  'inspectionRequired',p->'inspectionRequired','inspection',p->'inspection','earliestReceiptDate',p->'earliestReceiptDate');
end $$;

create or replace function public.shaikha_matching_packet(p_actor uuid,p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q public.resource_request%rowtype; rules public.shaikha_request_match_rules%rowtype;
 items jsonb; total integer; requested_type text; mandatory jsonb;
begin
 perform public.shaikha_require_requester(p_actor,p_request);
 select * into strict q from public.resource_request where request_id=p_request;
 select * into rules from public.shaikha_request_match_rules
 where request_id=p_request and confirmed_by=q.submitted_by
 and request_snapshot=public.shaikha_request_snapshot(q);
 requested_type:=public.shaikha_mandatory_item_type(rules.mandatory_requirements);
 mandatory:=rules.mandatory_requirements;
 if requested_type is not null then
  select jsonb_agg(case when x.value->>'field'='item_type' then jsonb_set(x.value,'{value}',to_jsonb(requested_type))
   else x.value end order by x.ordinality) into mandatory
  from jsonb_array_elements(rules.mandatory_requirements) with ordinality x(value,ordinality);
 end if;
 select count(*) into total from public.asset a join public.department d on d.department_id=a.owning_department_id
 where a.category_id=q.requested_category_id and a.is_published and a.asset_state='Available'
 and a.available_quantity>=q.quantity and a.condition in ('Good','Fair') and d.is_active;
 -- Resolve type BEFORE LIMIT 25: a printer must not be hidden behind the first
 -- 25 monitors in the same broad category. Provider lookups may therefore read
 -- more than 25 basic assets; the returned/AI shortlist is still bounded to 25.
 with facts as materialized (
  select a,public.shaikha_reusable_evidence(public.renad_reusable_asset_evidence(a.asset_id)) as evidence
  from public.asset a join public.department d on d.department_id=a.owning_department_id
  where requested_type is not null and a.category_id=q.requested_category_id
   and a.is_published and a.asset_state='Available' and a.available_quantity>=q.quantity
   and a.condition in ('Good','Fair') and d.is_active
 ), shortlist as (
  select f.a as asset_record,f.evidence from facts f
  where f.evidence#>>'{specifications,item_type}'=requested_type
  order by (f.a).asset_id limit 25
 )
 select coalesce(jsonb_agg(jsonb_build_object(
  'asset_id',(a.asset_record).asset_id,'name',(a.asset_record).name,'description',(a.asset_record).description,'condition',(a.asset_record).condition,
  'available_quantity',(a.asset_record).available_quantity,'category_id',(a.asset_record).category_id,
  'is_published',(a.asset_record).is_published,'asset_state',(a.asset_record).asset_state,'evidence',a.evidence,
  'evidence_snapshot',jsonb_build_object('contract','weighted-reusable-v2',
   'provider','renad_reusable_asset_evidence','asset',to_jsonb(a.asset_record),'rules',to_jsonb(rules),
   'request',public.shaikha_request_snapshot(q),'reusable_evidence',a.evidence)
 ) order by (a.asset_record).asset_id),'[]'::jsonb) into items from shortlist a;
 return jsonb_build_object('contract_version','weighted-reusable-v2','evidence_source','renad_reusable_asset_evidence',
  'request_id',q.request_id,'specifications',q.specifications,'purpose',q.purpose,'category_id',q.requested_category_id,
  'quantity',q.quantity,'preferred_condition',q.preferred_condition,'preferred_location',q.preferred_location,
  'required_date',q.required_date,'request_status',q.request_status,
  'assessment_date',((now() at time zone 'UTC')::date)::text,'base_total',total,'candidate_limit',25,
  'mandatory_requirements',mandatory,'preferred_requirements',rules.preferred_requirements,'candidates',items);
end $$;

create or replace function public.shaikha_confirm_matching_requirements(p_request_id uuid,p_mandatory jsonb,p_preferred jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare q public.resource_request%rowtype; actor uuid:=auth.uid(); previous_rules jsonb;
 old_type text; new_type text; normalized jsonb; n integer;
begin
 perform public.shaikha_require_requester(actor,p_request_id);
 select * into strict q from public.resource_request where request_id=p_request_id for update;
 if q.request_status not in ('Submitted','Under Review') or not public.shaikha_validate_requirements(p_mandatory)
 or not public.shaikha_validate_requirements(p_preferred) then raise exception 'Invalid requirements/state' using errcode='22023'; end if;
 if exists(select 1 from jsonb_array_elements(p_preferred) x where x->>'field'='item_type') then
  raise exception 'Item type must remain mandatory' using errcode='22023'; end if;
 select mandatory_requirements into previous_rules from public.shaikha_request_match_rules where request_id=p_request_id;
 old_type:=public.shaikha_mandatory_item_type(previous_rules);
 if previous_rules is not null and old_type is null and exists(
  select 1 from jsonb_array_elements(previous_rules) x where x->>'field'='item_type'
 ) then raise exception 'Existing item type rules need coordinated review' using errcode='22023'; end if;
 select count(*) into n from jsonb_array_elements(p_mandatory) x where x->>'field'='item_type';
 if n=0 and old_type is not null then
  normalized:=p_mandatory||jsonb_build_array(jsonb_build_object('field','item_type','operator','eq','value',old_type));
 else normalized:=p_mandatory; end if;
 new_type:=public.shaikha_mandatory_item_type(normalized);
 if new_type is null or (old_type is not null and new_type<>old_type)
  or not public.shaikha_validate_requirements(normalized) then
  raise exception 'Exactly one mandatory item type is required and an existing type cannot be changed here' using errcode='22023'; end if;
 select jsonb_agg(case when x.value->>'field'='item_type' then jsonb_set(x.value,'{value}',to_jsonb(new_type))
  else x.value end order by x.ordinality) into normalized from jsonb_array_elements(normalized) with ordinality x(value,ordinality);
 insert into public.shaikha_request_match_rules values(p_request_id,public.shaikha_request_snapshot(q),normalized,p_preferred,actor,now())
 on conflict(request_id) do update set request_snapshot=excluded.request_snapshot,mandatory_requirements=excluded.mandatory_requirements,
  preferred_requirements=excluded.preferred_requirements,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at;
 insert into public.audit_log(actor_id,action,record_type,record_id,new_value)
 values(actor,'Confirm Matching Requirements','resource_request',p_request_id,jsonb_build_object('mandatory',normalized,'preferred',p_preferred));
 return p_request_id;
end $$;

-- Remaining eligibility, save/read and review definitions follow unchanged in
-- their safety/scoring rules, except for the reusable source and snapshot gates.
create or replace function public.shaikha_evidence_eligible(packet jsonb,candidate jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare e jsonb:=candidate->'evidence'; rule jsonb; x jsonb; today date;
 required_on date; inspected date; until_on date; receipt date;
begin
 if packet->>'contract_version' is distinct from 'weighted-reusable-v2' or
 packet->>'evidence_source' is distinct from 'renad_reusable_asset_evidence' or
 public.shaikha_mandatory_item_type(packet->'mandatory_requirements') is null or
 exists(select 1 from jsonb_array_elements(packet->'preferred_requirements') x where x->>'field'='item_type') or
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
end $$;

create or replace function public.shaikha_save_weighted_matches(p_actor_id uuid,p_request_id uuid,p_ranking_run_id uuid,
 p_model_name text,p_model_version text,p_packet jsonb,p_matches jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare q public.resource_request%rowtype; packet jsonb; item jsonb; candidate jsonb; factors jsonb;
 weights jsonb:='{"specifications":35,"purposeSimilarity":25,"condition":10,"dateUrgency":10,"locationEffort":10,"financialEffect":5,"environmentalEffect":5}';
 entry record; available numeric; weighted numeric; score numeric; points jsonb; warning_list jsonb;
 position integer:=0; model_id uuid; cost numeric; previous_score numeric:=101;
 previous_cost numeric; previous_asset uuid; asset_id_value uuid; expected numeric; supplied numeric;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Server only' using errcode='42501'; end if;
 perform public.shaikha_require_requester(p_actor_id,p_request_id);
 select * into strict q from public.resource_request where request_id=p_request_id for update;
 if q.request_status not in ('Submitted','Under Review') or p_ranking_run_id is null
 or coalesce(length(btrim(p_model_name)),0) not between 1 and 80 or coalesce(length(btrim(p_model_version)),0) not between 1 and 80
 or jsonb_typeof(p_matches) is distinct from 'array' then raise exception 'Invalid run' using errcode='22023'; end if;
 if jsonb_array_length(p_matches) not between 1 and 5 then raise exception 'Expected 1..5 matches' using errcode='22023'; end if;
 if exists(select 1 from public.match_recommendation where ranking_run_id=p_ranking_run_id) then
  raise exception 'Run already saved; reload it' using errcode='22023'; end if;
 -- Lock the request, eligible base assets and evidence while validating/saving.
 perform a.asset_id from public.asset a where a.category_id=q.requested_category_id order by a.asset_id for share;
 -- Renad evidence writers MUST lock the same public.asset row FOR UPDATE.
 -- The provider is re-read through the packet; no request-pair evidence is used.
 packet:=public.shaikha_matching_packet(p_actor_id,p_request_id);
 if packet is distinct from p_packet then raise exception 'Stale packet' using errcode='22023'; end if;
 if (select count(distinct x->>'asset_id') from jsonb_array_elements(p_matches) x)<>jsonb_array_length(p_matches) then
 raise exception 'Duplicate asset' using errcode='22023'; end if;
 select model_version_id into model_id from public.model_version where provider='Google'
 and model_name=p_model_name and version_label=p_model_version and ai_function='matching' and is_active order by model_version_id limit 1;
 if model_id is null then
  insert into public.model_version(provider,model_name,version_label,ai_function) values('Google',p_model_name,p_model_version,'matching') returning model_version_id into model_id;
 end if;
 for item in select value from jsonb_array_elements(p_matches) loop
  asset_id_value:=(item->>'asset_id')::uuid;
  select c into candidate from jsonb_array_elements(packet->'candidates') c where c->>'asset_id'=asset_id_value::text;
  if candidate is null or not public.shaikha_evidence_eligible(packet,candidate)
  or item->'evidence_snapshot' is distinct from candidate->'evidence_snapshot'
  or item->>'scoring_version' is distinct from 'phase45-weighted-v1'
  or item->'confidence' is distinct from 'null'::jsonb
  or coalesce(length(btrim(item->>'explanation')),0) not between 1 and 240 then
   raise exception 'Invalid candidate/evidence' using errcode='22023'; end if;
  if jsonb_typeof(item#>'{factor_values,purposeSimilarity}') is distinct from 'number' then
   raise exception 'Invalid similarity' using errcode='22023'; end if;
  supplied:=(item#>>'{factor_values,purposeSimilarity}')::numeric;
  if supplied not between 0 and 1 then raise exception 'Similarity out of range' using errcode='22023'; end if;
  factors:=public.shaikha_factor_values(packet,candidate,supplied);
  available:=0; weighted:=0;
  for entry in select key,value from jsonb_each(weights) loop
   if factors->entry.key='null' then
    if item->'factor_values'->entry.key is distinct from 'null'::jsonb then raise exception 'Missing factor mismatch' using errcode='22023'; end if;
   else
    if jsonb_typeof(item->'factor_values'->entry.key) is distinct from 'number' then raise exception 'Invalid factor' using errcode='22023'; end if;
    expected:=(factors->>entry.key)::numeric;
    if abs(expected-(item->'factor_values'->>entry.key)::numeric)>0.0000000001 then raise exception 'Factor mismatch' using errcode='22023'; end if;
    available:=available+(entry.value#>>'{}')::numeric;
    weighted:=weighted+expected*(entry.value#>>'{}')::numeric;
   end if;
  end loop;
  score:=round(100*weighted/available,2); points:='{}';
  for entry in select key,value from jsonb_each(weights) loop
   points:=points||jsonb_build_object(entry.key,case when factors->entry.key='null' then null
    else round(100*(factors->>entry.key)::numeric*(entry.value#>>'{}')::numeric/available,6) end);
  end loop;
  if jsonb_typeof(item->'compatibility_score') is distinct from 'number'
  or abs((item->>'compatibility_score')::numeric-score)>0.011
  or (item->>'evidence_coverage')::numeric is distinct from available then raise exception 'Score mismatch' using errcode='22023'; end if;
  cost:=public.shaikha_evidence_number(candidate->'evidence','estimatedTransferRepairCost','costEvidence',9007199254740991);
  if score>previous_score or (score=previous_score and
   (coalesce(cost,1e30)<coalesce(previous_cost,1e30) or (cost is not distinct from previous_cost and asset_id_value<previous_asset))) then
    raise exception 'Incorrect ranking order' using errcode='22023'; end if;
  previous_score:=score; previous_cost:=cost; previous_asset:=asset_id_value;
  warning_list:='["AI confidence not supplied; no top-pick claim."]';
  if score<70 then warning_list:=warning_list||jsonb_build_array('Weak recommendation: compatibility is below 70/100.'); end if;
  if available<80 then warning_list:=warning_list||jsonb_build_array('Incomplete evidence: coverage is below 80%.'); end if;
  if (factors->>'purposeSimilarity')::numeric<0.7 then warning_list:=warning_list||jsonb_build_array('Weak semantic match: similarity is below 0.70.'); end if;
  position:=position+1;
  insert into public.match_recommendation(request_id,asset_id,model_version_id,ranking_run_id,rank_position,
   compatibility_score,confidence,explanation,missing_data_flags,scoring_version,evidence_coverage,
   factor_values,factor_contributions,warnings,evidence_snapshot,estimated_transfer_repair_cost)
  values(p_request_id,asset_id_value,model_id,p_ranking_run_id,position,score,null,btrim(item->>'explanation'),
   (select string_agg(key,', ' order by key) from jsonb_each(factors) where value='null'),
   'phase45-weighted-v1',available,factors,points,warning_list,candidate->'evidence_snapshot',cost);
 end loop;
 insert into public.audit_log(actor_id,action,record_type,record_id,new_value,model_version_id)
 values(p_actor_id,'Save Weighted Matches','resource_request',p_request_id,
 jsonb_build_object('run_id',p_ranking_run_id,'count',position,'scoring_version','phase45-weighted-v1'),model_id);
 return p_ranking_run_id;
end $$;

create or replace function public.shaikha_review_match(p_recommendation_id uuid,p_decision text,p_reason text) returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); q public.resource_request%rowtype; m public.match_recommendation%rowtype;
 request_value uuid; packet jsonb; candidate jsonb;
begin
 select request_id into request_value from public.match_recommendation where recommendation_id=p_recommendation_id;
 perform public.shaikha_require_requester(actor,request_value);
 select * into strict q from public.resource_request where request_id=request_value for update;
 select * into strict m from public.match_recommendation where recommendation_id=p_recommendation_id for update;
 if p_decision is null or p_decision not in ('accepted','rejected') or length(coalesce(p_reason,''))>1000
 or (p_decision='rejected' and nullif(btrim(p_reason),'') is null) or q.request_status not in ('Submitted','Under Review') then
 raise exception 'Invalid review' using errcode='22023'; end if;
 if m.review_status=p_decision and p_decision='rejected' then return m.recommendation_id; end if;
 if m.review_status not in ('pending',p_decision) then raise exception 'Already reviewed' using errcode='22023'; end if;
 if p_decision='accepted' then
  perform 1 from public.asset where asset_id=m.asset_id for share;
  -- Same parent-asset lock discipline as Renad evidence updates/approval.
  packet:=public.shaikha_matching_packet(actor,request_value);
  select c into candidate from jsonb_array_elements(packet->'candidates') c where c->>'asset_id'=m.asset_id::text;
  if m.scoring_version is distinct from 'phase45-weighted-v1' or candidate is null
   or m.evidence_snapshot is distinct from candidate->'evidence_snapshot'
   or not public.shaikha_evidence_eligible(packet,candidate) then raise exception 'Stale/ineligible match' using errcode='22023'; end if;
 end if;
 if m.review_status=p_decision then return m.recommendation_id; end if;
 update public.match_recommendation set review_status=p_decision,reviewed_by=actor,reviewed_at=now(),review_reason=nullif(btrim(p_reason),'')
 where recommendation_id=m.recommendation_id;
 insert into public.audit_log(actor_id,action,record_type,record_id,new_value)
 values(actor,'Review Match Recommendation','match_recommendation',m.recommendation_id,jsonb_build_object('decision',p_decision,'reason',p_reason));
 -- No reservation, approval, request status or available_quantity mutation.
 return m.recommendation_id;
end $$;

create or replace function public.shaikha_read_matches(p_request_id uuid,p_ranking_run_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); run uuid:=p_ranking_run_id; packet jsonb; result jsonb;
begin
 perform public.shaikha_require_requester(actor,p_request_id);
 packet:=public.shaikha_matching_packet(actor,p_request_id);
 if run is null then select ranking_run_id into run from public.match_recommendation where request_id=p_request_id
 and scoring_version='phase45-weighted-v1' order by created_at desc,ranking_run_id limit 1; end if;
 select coalesce(jsonb_agg(z.item order by z.rank_position),'[]') into result from (
 select m.rank_position,to_jsonb(m)||jsonb_build_object('name',a.name,'condition',a.condition,'available_quantity',a.available_quantity,
 'currently_eligible',coalesce(packet->>'request_status' in ('Submitted','Under Review')
 and m.evidence_snapshot=c.value->'evidence_snapshot' and public.shaikha_evidence_eligible(packet,c.value),false)) as item
 from public.match_recommendation m join public.asset a on a.asset_id=m.asset_id
 left join lateral (select value from jsonb_array_elements(packet->'candidates') where value->>'asset_id'=m.asset_id::text) c on true
 where m.request_id=p_request_id and m.ranking_run_id=run and m.scoring_version='phase45-weighted-v1'
 order by m.rank_position limit 5) z;
 return jsonb_build_object('contract_version','weighted-reusable-v2','evidence_source','renad_reusable_asset_evidence','matches',result);
end $$;

-- Keep private helpers and the privileged writer private after replacement.
revoke all on function public.shaikha_matching_item_type(text),public.shaikha_mandatory_item_type(jsonb),
 public.shaikha_reusable_evidence(jsonb),public.shaikha_matching_packet(uuid,uuid),
 public.shaikha_evidence_eligible(jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.shaikha_confirm_matching_requirements(uuid,jsonb,jsonb),
 public.shaikha_review_match(uuid,text,text),public.shaikha_read_matches(uuid,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.shaikha_confirm_matching_requirements(uuid,jsonb,jsonb),
 public.shaikha_review_match(uuid,text,text),public.shaikha_read_matches(uuid,uuid) to authenticated;
revoke all on function public.shaikha_save_weighted_matches(uuid,uuid,uuid,text,text,jsonb,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.shaikha_save_weighted_matches(uuid,uuid,uuid,text,text,jsonb,jsonb) to service_role;

commit;
