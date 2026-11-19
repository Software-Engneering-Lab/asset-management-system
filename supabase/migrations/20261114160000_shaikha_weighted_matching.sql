-- AI2 correction, REVIEW BEFORE APPLYING ONCE.
-- Requires foundation, contract and Shaikha migrations 001..006.
-- Does not edit applied migrations, C1/C2 roles or C5/C6 stock workflows.
begin;

-- Feature-owned adapters: no evidence is inferred from Available/Good.
create table public.shaikha_request_match_rules (
 request_id uuid primary key references public.resource_request,
 request_snapshot jsonb not null,
 mandatory_requirements jsonb not null, preferred_requirements jsonb not null,
 confirmed_by uuid not null references public.app_user, confirmed_at timestamptz not null default now()
);
create table public.shaikha_asset_match_evidence (
 request_id uuid not null references public.resource_request,
 asset_id uuid not null references public.asset,
 asset_snapshot jsonb not null, evidence jsonb not null,
 reviewed_by uuid not null references public.app_user,
 source_reference text not null check (length(btrim(source_reference)) between 1 and 1000),
 reviewed_at timestamptz not null default now(), expires_at timestamptz not null,
 primary key(request_id,asset_id), check(expires_at>reviewed_at)
);
create table public.shaikha_matching_attempt (
 actor_id uuid primary key references public.app_user, attempted_at timestamptz not null
);
alter table public.shaikha_request_match_rules enable row level security;
alter table public.shaikha_asset_match_evidence enable row level security;
alter table public.shaikha_matching_attempt enable row level security;
revoke all on public.shaikha_request_match_rules,public.shaikha_asset_match_evidence,public.shaikha_matching_attempt from public,anon,authenticated;
-- Evidence writes deliberately remain a reviewed database-owner operation.
-- No client self-certification, new profile provisioner or asset-editor changes.

alter table public.match_recommendation
 add column scoring_version text,
 add column evidence_coverage numeric(5,2),
 add column factor_values jsonb,
 add column factor_contributions jsonb,
 add column warnings jsonb not null default '[]',
 add column evidence_snapshot jsonb,
 add column estimated_transfer_repair_cost numeric;

create function public.shaikha_request_snapshot(p public.resource_request) returns jsonb
language sql immutable set search_path='' as $$
 select to_jsonb(p)-array['request_status','created_at','submitted_at']
$$;
create function public.shaikha_asset_snapshot(p public.asset) returns jsonb
language sql immutable set search_path='' as $$
 select to_jsonb(p)-array['available_quantity','quantity','asset_state','is_published','created_at']
$$;
create function public.shaikha_require_requester(p_actor uuid,p_request uuid) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if not exists(select 1 from public.resource_request q
 join public.app_user u on u.user_id=q.submitted_by
 join public.department d on d.department_id=u.department_id
 join public.user_role ur on ur.user_id=u.user_id
 join public.role r on r.role_id=ur.role_id
 where q.request_id=p_request and q.submitted_by=p_actor
 and u.account_status='active' and d.is_active and r.role_name='requester') then
 raise exception 'Owned request and active requester required' using errcode='42501'; end if;
end $$;
create function public.shaikha_validate_requirements(p jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare x jsonb;
begin
 if jsonb_typeof(p) is distinct from 'array' then return false; end if;
 if jsonb_array_length(p)>50 then return false; end if;
 for x in select value from jsonb_array_elements(p) loop
  if jsonb_typeof(x) is distinct from 'object' or
   coalesce(x->>'field','')!~'^[a-z][a-z0-9_]{0,63}$' or
   coalesce(x->>'operator','') not in ('eq','gte','lte') or
   coalesce(jsonb_typeof(x->'value'),'null') not in ('string','number','boolean') then return false; end if;
  if x->>'operator'<>'eq' and jsonb_typeof(x->'value')<>'number' then return false; end if;
  if jsonb_typeof(x->'value')='string' and (length(btrim(x->>'value'))=0 or length(x->>'value')>1000) then return false; end if;
 end loop;
 return true;
end $$;
create function public.shaikha_spec_satisfies(actual jsonb,rule jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
begin
 if actual is null or actual='null' or jsonb_typeof(actual)<>jsonb_typeof(rule->'value') then return false; end if;
 if rule->>'operator'='eq' then
  if jsonb_typeof(actual)='string' then return lower(btrim(actual#>>'{}'))=lower(btrim(rule->>'value')); end if;
  return actual=rule->'value';
 end if;
 if jsonb_typeof(actual)<>'number' then return false; end if;
 if rule->>'operator'='gte' then return (actual#>>'{}')::numeric>=(rule->>'value')::numeric; end if;
 if rule->>'operator'='lte' then return (actual#>>'{}')::numeric<=(rule->>'value')::numeric; end if;
 return false;
end $$;
create function public.shaikha_date(p text) returns date
language plpgsql immutable set search_path='' as $$
declare d date;
begin
 if p is null or p!~'^\d{4}-\d{2}-\d{2}$' then return null; end if;
 d:=p::date; if to_char(d,'YYYY-MM-DD')<>p then return null; end if; return d;
exception when others then return null;
end $$;

create function public.shaikha_matching_packet(p_actor uuid,p_request uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q public.resource_request%rowtype; rules public.shaikha_request_match_rules%rowtype;
 items jsonb; total integer;
begin
 perform public.shaikha_require_requester(p_actor,p_request);
 select * into strict q from public.resource_request where request_id=p_request;
 select * into rules from public.shaikha_request_match_rules
 where request_id=p_request and confirmed_by=q.submitted_by
 and request_snapshot=public.shaikha_request_snapshot(q);
 select count(*) into total from public.asset a join public.department d on d.department_id=a.owning_department_id
 where a.category_id=q.requested_category_id and a.is_published and a.asset_state='Available'
 and a.available_quantity>=q.quantity and a.condition in ('Good','Fair') and d.is_active;
 select coalesce(jsonb_agg(z.item order by z.asset_id),'[]') into items from (
 select a.asset_id, jsonb_build_object('asset_id',a.asset_id,'name',a.name,'description',a.description,
 'condition',a.condition,'available_quantity',a.available_quantity,'category_id',a.category_id,
 'is_published',a.is_published,'asset_state',a.asset_state,
 'evidence',e.evidence,
 'evidence_snapshot',jsonb_build_object('asset',to_jsonb(a),'rules',to_jsonb(rules),
 'request',public.shaikha_request_snapshot(q),'verified_record',to_jsonb(e))) as item
 from (select a.* from public.asset a join public.department d on d.department_id=a.owning_department_id
 where a.category_id=q.requested_category_id and a.is_published and a.asset_state='Available'
 and a.available_quantity>=q.quantity and a.condition in ('Good','Fair') and d.is_active
 order by a.asset_id limit 25) a
 left join public.shaikha_asset_match_evidence e on e.request_id=p_request and e.asset_id=a.asset_id
 and e.asset_snapshot=public.shaikha_asset_snapshot(a::public.asset) and e.expires_at>now() and e.reviewed_at<=now()
 and exists(select 1 from public.app_user u join public.department d on d.department_id=u.department_id
 join public.user_role ur on ur.user_id=u.user_id join public.role r on r.role_id=ur.role_id
 where u.user_id=e.reviewed_by and u.account_status='active' and d.is_active
 and (r.role_name='admin' or (r.role_name='custodian' and
 (a.custodian_id=u.user_id or a.owning_department_id=u.department_id))))
 ) z;
 return jsonb_build_object('contract_version','weighted-evidence-v1','request_id',q.request_id,
 'specifications',q.specifications,'purpose',q.purpose,'category_id',q.requested_category_id,
 'quantity',q.quantity,'preferred_condition',q.preferred_condition,'preferred_location',q.preferred_location,
 'required_date',q.required_date,'request_status',q.request_status,
 'assessment_date',((now() at time zone 'UTC')::date)::text,'base_total',total,'candidate_limit',25,
 'mandatory_requirements',rules.mandatory_requirements,'preferred_requirements',rules.preferred_requirements,'candidates',items);
end $$;

create function public.shaikha_evidence_eligible(packet jsonb,candidate jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare e jsonb:=candidate->'evidence'; rule jsonb; x jsonb; today date;
 required_on date; inspected date; until_on date; receipt date;
begin
 if not public.shaikha_validate_requirements(packet->'mandatory_requirements') or
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
  if required_on is null or receipt is null or receipt>required_on then return false; end if;
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

create function public.shaikha_evidence_number(e jsonb,field text,source text,maximum numeric) returns numeric
language plpgsql immutable set search_path='' as $$
declare n numeric;
begin
 if field='estimatedTransferRepairCost' and e->>'costCurrency' is distinct from 'AED' then return null; end if;
 if jsonb_typeof(e->field) is distinct from 'number' or jsonb_typeof(e->source) is distinct from 'string'
 or length(btrim(e->>source))=0 then return null; end if;
 n:=(e->>field)::numeric; if n<0 or n>maximum then return null; end if; return n;
end $$;

create function public.shaikha_factor_values(packet jsonb,candidate jsonb,similarity numeric) returns jsonb
language plpgsql immutable set search_path='' as $$
declare e jsonb:=candidate->'evidence'; rule jsonb; clauses jsonb;
 spec_score numeric; passed integer:=0; complete boolean:=true;
 cost numeric; min_cost numeric; max_cost numeric; condition_score numeric;
begin
 clauses:=(packet->'mandatory_requirements')||(packet->'preferred_requirements');
 for rule in select value from jsonb_array_elements(packet->'preferred_requirements') loop
  if e->'specifications'->(rule->>'field') is null or e->'specifications'->(rule->>'field')='null' then complete:=false; end if;
 end loop;
 if complete and jsonb_array_length(clauses)>0 then
  for rule in select value from jsonb_array_elements(clauses) loop
   if public.shaikha_spec_satisfies(e->'specifications'->(rule->>'field'),rule) then passed:=passed+1; end if;
  end loop;
  spec_score:=passed::numeric/jsonb_array_length(clauses);
 end if;
 if packet->>'preferred_condition' in ('Good','Fair','Poor') then
  condition_score:=case when packet->>'preferred_condition'='Good' and candidate->>'condition'='Fair' then 0.5 else 1 end;
 end if;
 cost:=public.shaikha_evidence_number(e,'estimatedTransferRepairCost','costEvidence',9007199254740991);
 select min(public.shaikha_evidence_number(c->'evidence','estimatedTransferRepairCost','costEvidence',9007199254740991)),
 max(public.shaikha_evidence_number(c->'evidence','estimatedTransferRepairCost','costEvidence',9007199254740991)) into min_cost,max_cost
 from jsonb_array_elements(packet->'candidates') c where public.shaikha_evidence_eligible(packet,c);
 return jsonb_build_object('specifications',spec_score,'purposeSimilarity',similarity,'condition',condition_score,
 'dateUrgency',case when packet->>'required_date' is not null then 1 else null end,
 'locationEffort',public.shaikha_evidence_number(e,'locationEffortScore','locationEvidence',1),
 'financialEffect',case when cost is null then null when max_cost=min_cost then 1 else (max_cost-cost)/(max_cost-min_cost) end,
 'environmentalEffect',public.shaikha_evidence_number(e,'environmentalEffectScore','environmentalEvidence',1));
end $$;

create function public.shaikha_confirm_matching_requirements(p_request_id uuid,p_mandatory jsonb,p_preferred jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare q public.resource_request%rowtype; actor uuid:=auth.uid();
begin
 perform public.shaikha_require_requester(actor,p_request_id);
 select * into strict q from public.resource_request where request_id=p_request_id for update;
 if q.request_status not in ('Submitted','Under Review') or not public.shaikha_validate_requirements(p_mandatory)
 or not public.shaikha_validate_requirements(p_preferred) then raise exception 'Invalid requirements/state' using errcode='22023'; end if;
 insert into public.shaikha_request_match_rules values(p_request_id,public.shaikha_request_snapshot(q),p_mandatory,p_preferred,actor,now())
 on conflict(request_id) do update set request_snapshot=excluded.request_snapshot,mandatory_requirements=excluded.mandatory_requirements,
 preferred_requirements=excluded.preferred_requirements,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at;
 insert into public.audit_log(actor_id,action,record_type,record_id,new_value)
 values(actor,'Confirm Matching Requirements','resource_request',p_request_id,jsonb_build_object('mandatory',p_mandatory,'preferred',p_preferred));
 return p_request_id;
end $$;

create or replace function public.shaikha_matching_candidates(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); q public.resource_request%rowtype;
begin
 perform public.shaikha_require_requester(actor,p_request_id);
 select * into strict q from public.resource_request where request_id=p_request_id for update;
 if q.request_status not in ('Submitted','Under Review') then raise exception 'Closed request' using errcode='22023'; end if;
 insert into public.shaikha_matching_attempt values(actor,clock_timestamp()) on conflict(actor_id) do update
 set attempted_at=excluded.attempted_at where public.shaikha_matching_attempt.attempted_at<clock_timestamp()-interval '15 seconds';
 if not found then raise exception 'Matching cooldown' using errcode='P0001'; end if;
 return public.shaikha_matching_packet(actor,p_request_id);
end $$;

-- Disable the old arbitrary-total writer, including for the service role.
revoke all on function public.shaikha_save_matches(uuid,uuid,uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;

create function public.shaikha_save_weighted_matches(p_actor_id uuid,p_request_id uuid,p_ranking_run_id uuid,
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
 perform e.asset_id from public.shaikha_asset_match_evidence e where e.request_id=p_request_id order by e.asset_id for share;
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
 if m.review_status=p_decision then return m.recommendation_id; end if;
 if m.review_status<>'pending' then raise exception 'Already reviewed' using errcode='22023'; end if;
 if p_decision='accepted' then
  perform 1 from public.asset where asset_id=m.asset_id for share;
  perform 1 from public.shaikha_asset_match_evidence where request_id=request_value and asset_id=m.asset_id for share;
  packet:=public.shaikha_matching_packet(actor,request_value);
  select c into candidate from jsonb_array_elements(packet->'candidates') c where c->>'asset_id'=m.asset_id::text;
  if m.scoring_version is distinct from 'phase45-weighted-v1' or candidate is null
   or m.evidence_snapshot is distinct from candidate->'evidence_snapshot'
   or not public.shaikha_evidence_eligible(packet,candidate) then raise exception 'Stale/ineligible match' using errcode='22023'; end if;
 end if;
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
 return jsonb_build_object('contract_version','weighted-evidence-v1','matches',result);
end $$;

-- Private helpers must not be remotely callable (default PUBLIC EXECUTE removed).
revoke all on function public.shaikha_request_snapshot(public.resource_request),public.shaikha_asset_snapshot(public.asset),
 public.shaikha_require_requester(uuid,uuid),public.shaikha_validate_requirements(jsonb),public.shaikha_spec_satisfies(jsonb,jsonb),
 public.shaikha_date(text),public.shaikha_matching_packet(uuid,uuid),public.shaikha_evidence_eligible(jsonb,jsonb),
 public.shaikha_evidence_number(jsonb,text,text,numeric),public.shaikha_factor_values(jsonb,jsonb,numeric)
 from public,anon,authenticated,service_role;
revoke all on function public.shaikha_confirm_matching_requirements(uuid,jsonb,jsonb),public.shaikha_matching_candidates(uuid),
 public.shaikha_review_match(uuid,text,text),public.shaikha_read_matches(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.shaikha_confirm_matching_requirements(uuid,jsonb,jsonb),public.shaikha_matching_candidates(uuid),
 public.shaikha_review_match(uuid,text,text),public.shaikha_read_matches(uuid,uuid) to authenticated;
revoke all on function public.shaikha_save_weighted_matches(uuid,uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.shaikha_save_weighted_matches(uuid,uuid,uuid,text,text,jsonb,jsonb) to service_role;
commit;
