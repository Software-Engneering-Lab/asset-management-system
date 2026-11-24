-- Apply once AFTER Shaikha's 20261114160000 weighted-matching migration
-- and Renad's 20261114100000 approval/reservation migration.
-- No UPDATE of existing requests, reservations, quantities or expiry dates occurs here.
begin;

do $$ begin
  if to_regprocedure('public.shaikha_evidence_eligible(jsonb,jsonb)') is null then
    raise exception 'Apply Shaikha weighted-matching migration first.';
  end if;
end; $$;

-- The same predicate is used for dropdowns, approval, reservation and release.
-- p_held=true checks units already reserved for THIS request, not free stock.
create function public.renad_eligibility_problem(p_request uuid,p_asset uuid,p_held boolean default false)
returns text language plpgsql stable security definer set search_path='' as $$
declare
 q public.resource_request; a public.asset;
 rules public.shaikha_request_match_rules; evidence public.shaikha_asset_match_evidence;
 held integer:=0; packet jsonb; candidate jsonb;
begin
 select * into q from public.resource_request where request_id=p_request;
 if not found then return 'Request not found.'; end if;
 select * into a from public.asset where asset_id=p_asset;
 if not found then return 'Asset not found.'; end if;
 if not exists(select 1 from public.app_user where user_id=q.submitted_by and account_status='active')
 or not exists(select 1 from public.department where department_id=q.requesting_department_id and is_active)
 or not exists(select 1 from public.department where department_id=a.owning_department_id and is_active) then
  return 'The requester and both departments must be active.';
 end if;
 select * into rules from public.shaikha_request_match_rules where request_id=p_request
  and confirmed_by=q.submitted_by and request_snapshot=public.shaikha_request_snapshot(q);
 if not found then return 'Requester must confirm the item type and requirements.'; end if;
 -- A monitor, keyboard and printer share a category. The confirmed item_type distinguishes them.
 if not exists(select 1 from jsonb_array_elements(rules.mandatory_requirements) x
   where x->>'field'='item_type' and x->>'operator'='eq'
   and jsonb_typeof(x->'value')='string' and length(btrim(x->>'value'))>0) then
  return 'Requester must confirm a specific item type, such as monitor or keyboard.';
 end if;
 select * into evidence from public.shaikha_asset_match_evidence e
  where e.request_id=p_request and e.asset_id=p_asset
  and e.asset_snapshot=public.shaikha_asset_snapshot(a)
  and e.expires_at>statement_timestamp() and e.reviewed_at<=statement_timestamp();
 if not found then return 'Custodian must record current specification and safety evidence.'; end if;
 if not exists(select 1 from public.app_user u join public.department d on d.department_id=u.department_id
  join public.user_role ur on ur.user_id=u.user_id join public.role r on r.role_id=ur.role_id
  where u.user_id=evidence.reviewed_by and u.account_status='active' and d.is_active
  and (r.role_name='admin' or (r.role_name='custodian' and u.department_id=a.owning_department_id))) then
  return 'Evidence reviewer is no longer authorized.';
 end if;
 if evidence.evidence->>'requestSpecifications' is distinct from q.specifications
 or evidence.evidence->>'specificationsVerified' is distinct from 'true' then
  return 'Custodian must verify the full written specifications for this request.';
 end if;
 if p_held then
  select coalesce(sum(reserved_quantity),0)::integer into held from public.reservation
   where request_id=p_request and asset_id=p_asset and reservation_status='Active'
   and expires_at>statement_timestamp();
  if held<>q.quantity or a.asset_state not in ('Available','Reserved','In Transfer') then
   return 'The approved hold is expired, missing, or the asset is restricted.';
  end if;
 end if;
 packet:=jsonb_build_object('category_id',q.requested_category_id,'quantity',q.quantity,
  'required_date',q.required_date,'assessment_date',(statement_timestamp() at time zone 'UTC')::date,
  'mandatory_requirements',rules.mandatory_requirements,'preferred_requirements',rules.preferred_requirements);
 candidate:=jsonb_build_object('category_id',a.category_id,'condition',a.condition,
  'is_published',case when p_held then true else a.is_published end,
  'asset_state',case when p_held then 'Available' else a.asset_state end,
  'available_quantity',case when p_held then held else a.available_quantity end,'evidence',evidence.evidence);
 if public.shaikha_evidence_eligible(packet,candidate) is not true then
  return 'Asset fails the confirmed specifications, safety, inspection, date or quantity requirements.';
 end if;
 -- Preferred condition is a ranking preference (Phase 4-5 section 8.11), not a mandatory minimum.
 return null;
end; $$;
revoke all on function public.renad_eligibility_problem(uuid,uuid,boolean) from public,anon,authenticated;

-- Existing approve/reserve functions already call this helper while holding request/asset locks.
create or replace function public.renad_check_asset(p_request_id uuid,p_asset_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare problem text;
begin
 perform 1 from public.shaikha_request_match_rules where request_id=p_request_id for share;
 perform 1 from public.shaikha_asset_match_evidence where request_id=p_request_id and asset_id=p_asset_id for share;
 problem:=public.renad_eligibility_problem(p_request_id,p_asset_id,false);
 if problem is not null then raise exception '%',problem using errcode='22023'; end if;
end; $$;

-- Requester confirms the item type without erasing Shaikha's other structured requirements.
-- Reserved requests are supported so the existing monitor hold can be verified without cancelling it.
create function public.renad_confirm_item_type(p_request uuid,p_item_type text)
returns void language plpgsql security definer set search_path='' as $$
declare q public.resource_request; rules public.shaikha_request_match_rules; mandatory jsonb;
begin
 select * into q from public.resource_request where request_id=p_request for update;
 if not found then raise exception 'Request not found.' using errcode='22023'; end if;
 perform public.shaikha_require_requester(auth.uid(),p_request);
 if q.request_status not in ('Submitted','Under Review','Approved','Reserved') then
  raise exception 'Requirements cannot change after release.' using errcode='22023'; end if;
 if p_item_type is null or length(btrim(p_item_type)) not between 1 and 80 then
  raise exception 'Enter a specific item type (1-80 characters).' using errcode='22023'; end if;
 select * into rules from public.shaikha_request_match_rules where request_id=p_request;
 if found and rules.request_snapshot is distinct from public.shaikha_request_snapshot(q) then
  raise exception 'Request changed. Reconfirm all requirements in the Requests page first.' using errcode='22023'; end if;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into mandatory
  from jsonb_array_elements(coalesce(rules.mandatory_requirements,'[]'::jsonb)) x where x->>'field'<>'item_type';
 mandatory:=mandatory||jsonb_build_array(jsonb_build_object('field','item_type','operator','eq','value',lower(btrim(p_item_type))));
 if not public.shaikha_validate_requirements(mandatory) then
  raise exception 'The confirmed requirements are invalid or exceed 50 rules.' using errcode='22023'; end if;
 insert into public.shaikha_request_match_rules(request_id,request_snapshot,mandatory_requirements,preferred_requirements,confirmed_by)
  values(p_request,public.shaikha_request_snapshot(q),mandatory,coalesce(rules.preferred_requirements,'[]'::jsonb),auth.uid())
 on conflict(request_id) do update set request_snapshot=excluded.request_snapshot,
  mandatory_requirements=excluded.mandatory_requirements,confirmed_by=excluded.confirmed_by,confirmed_at=now();
 perform public.write_audit('ITEM_TYPE_CONFIRMED','resource_request',p_request,null,mandatory);
end; $$;

-- Trusted custodian records facts, not an AI guess. No stock/state change is performed.
create function public.renad_verify_asset(
 p_request uuid,p_asset uuid,p_specifications jsonb,p_safety text,p_inspection_required boolean,
 p_inspected_on date,p_inspection_valid_until date,p_receipt_date date,p_valid_until date,
 p_source text,p_verified boolean)
returns void language plpgsql security definer set search_path='' as $$
declare q public.resource_request; a public.asset; evidence jsonb;
begin
 select * into q from public.resource_request where request_id=p_request for update;
 if not found then raise exception 'Request not found.' using errcode='22023'; end if;
 select * into a from public.asset where asset_id=p_asset for update;
 if not found then raise exception 'Asset not found.' using errcode='22023'; end if;
 if (public.has_role('admin') or (public.has_role('custodian') and a.owning_department_id=public.current_department_id())) is not true
 or not exists(select 1 from public.department where department_id=public.current_department_id() and is_active) then
  raise exception 'An active custodian of the owning department or admin must verify facts.' using errcode='42501'; end if;
 if a.category_id<>q.requested_category_id then
  raise exception 'Asset and request categories must match.' using errcode='22023'; end if;
 if q.request_status not in ('Submitted','Under Review','Approved','Reserved') then
  raise exception 'Cannot revise pre-release evidence for this request now.' using errcode='22023'; end if;
 if p_verified is not true or jsonb_typeof(p_specifications) is distinct from 'object'
 or p_safety is null or p_safety not in ('clear','restricted','unknown') or p_inspection_required is null
 or p_source is null or length(btrim(p_source)) not between 1 and 1000
 or p_valid_until is null or p_valid_until<(statement_timestamp() at time zone 'UTC')::date
 or p_valid_until>(statement_timestamp() at time zone 'UTC')::date+30 then
  raise exception 'Confirm the facts, source and evidence validity (today through 30 days).' using errcode='22023'; end if;
 if p_inspection_required and (p_inspected_on is null or p_inspection_valid_until is null
 or p_inspected_on>(statement_timestamp() at time zone 'UTC')::date or p_inspection_valid_until<p_inspected_on) then
  raise exception 'A completed required inspection needs valid inspection dates.' using errcode='22023'; end if;
 evidence:=jsonb_build_object('specifications',p_specifications,'safetyStatus',p_safety,
  'inspectionRequired',p_inspection_required,'inspection',case when p_inspection_required then
    jsonb_build_object('result','passed','inspectedOn',p_inspected_on,'validUntil',p_inspection_valid_until) else 'null'::jsonb end,
  'earliestReceiptDate',p_receipt_date,'requestSpecifications',q.specifications,'specificationsVerified',true);
 insert into public.shaikha_asset_match_evidence(request_id,asset_id,asset_snapshot,evidence,reviewed_by,source_reference,expires_at)
 values(p_request,p_asset,public.shaikha_asset_snapshot(a),evidence,auth.uid(),btrim(p_source),
   (p_valid_until+1)::timestamp at time zone 'UTC')
 on conflict(request_id,asset_id) do update set asset_snapshot=excluded.asset_snapshot,evidence=excluded.evidence,
  reviewed_by=excluded.reviewed_by,source_reference=excluded.source_reference,reviewed_at=now(),expires_at=excluded.expires_at;
 perform public.write_audit('ASSET_FACTS_VERIFIED','asset',p_asset,null,
  jsonb_build_object('request_id',p_request,'evidence',evidence),btrim(p_source));
end; $$;

-- Preserve the existing workspace shape and use the SAME eligibility predicate as writes.
-- Preferred condition remains a ranking preference; mandatory requirements live in confirmed rules.
create or replace function public.renad_approval_workspace() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_requests jsonb;
begin
  perform public.renad_require_approver();
  select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at,q.request_id),'[]'::jsonb) into v_requests
  from (
    select r.request_id,r.submitted_by,r.specifications,r.quantity,r.preferred_condition,
      r.purpose,r.urgency,r.request_status,r.created_at,c.name as category,u.full_name as requester,
      d.name as department,
      (select to_jsonb(ap) from public.approval ap where ap.request_id=r.request_id
        order by ap.decided_at desc,ap.approval_id desc limit 1) as latest_approval,
      (select to_jsonb(h) from public.reservation h where h.request_id=r.request_id
        and h.reservation_status='Active') as reservation,
      (select coalesce(jsonb_agg(jsonb_build_object('asset_id',a.asset_id,'name',a.name,
        'condition',a.condition,'available_quantity',a.available_quantity) order by a.name,a.asset_id),'[]'::jsonb)
        from public.asset a join public.department ad on ad.department_id=a.owning_department_id
        where a.category_id=r.requested_category_id and a.is_published and a.asset_state='Available'
        and a.available_quantity>=r.quantity and a.condition in ('Good','Fair') and ad.is_active
        and public.renad_eligibility_problem(r.request_id,a.asset_id,false) is null) as assets,
      (select coalesce(jsonb_agg(jsonb_build_object('asset_id',m.asset_id,'review_status',m.review_status,
        'score',m.compatibility_score,'explanation',m.explanation,'created_at',m.created_at)
        order by m.created_at desc,m.rank_position),'[]'::jsonb)
        from public.match_recommendation m where m.request_id=r.request_id and m.review_status='accepted') as accepted_matches,
      (select coalesce(jsonb_agg(jsonb_build_object('to_status',sh.to_status,'changed_at',sh.changed_at,
        'reason',sh.reason,'actor',hu.full_name) order by sh.changed_at,sh.history_id),'[]'::jsonb)
        from public.request_status_history sh join public.app_user hu on hu.user_id=sh.changed_by
        where sh.request_id=r.request_id) as history
    from public.resource_request r join public.app_user u on u.user_id=r.submitted_by
      join public.department d on d.department_id=r.requesting_department_id
      join public.asset_category c on c.category_id=r.requested_category_id
    where r.request_status in ('Submitted','Under Review','Approved','Reserved')
    order by r.created_at,r.request_id limit 100
  ) q;
  return jsonb_build_object('requests',v_requests);
end;
$$;

revoke all on function public.renad_approval_workspace() from public,anon,authenticated;
revoke all on function public.renad_confirm_item_type(uuid,text) from public,anon,authenticated;
revoke all on function public.renad_verify_asset(uuid,uuid,jsonb,text,boolean,date,date,date,date,text,boolean) from public,anon,authenticated;
grant execute on function public.renad_approval_workspace(),public.renad_confirm_item_type(uuid,text),
 public.renad_verify_asset(uuid,uuid,jsonb,text,boolean,date,date,date,date,text,boolean) to authenticated;
commit;
