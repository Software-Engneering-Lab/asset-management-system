-- Renad C5 milestone 1: review, decision, reservation, cancellation and expiry.
-- Requires both foundation migrations and Budoor's 20261114090000 migration.
-- Compatible with Shaikha's submission/history RPCs: no duplicate history trigger.
begin;

-- One active reservation per request. Expired rows are retained as history.
create unique index renad_one_active_reservation
  on public.reservation(request_id) where reservation_status = 'Active';

-- Recheck active profile AND department for every operation, including direct RPC calls.
create function public.renad_require_approver() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (public.has_role('approver') or public.has_role('admin'))
    or not exists (select 1 from public.app_user u join public.department d
      on d.department_id = u.department_id where u.user_id = auth.uid()
      and u.account_status = 'active' and d.is_active) then
    raise exception 'An active approver or admin account is required.' using errcode = '42501';
  end if;
end;
$$;

-- Private helper: exactly one status-history entry and one audit entry per change.
-- Shaikha already records Submitted; this helper records only our later changes.
create function public.renad_set_request_status(p_request_id uuid, p_status text, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old text;
begin
  select request_status into strict v_old from public.resource_request
    where request_id = p_request_id for update;
  if v_old = p_status then return; end if;
  update public.resource_request set request_status = p_status where request_id = p_request_id;
  insert into public.request_status_history(request_id,from_status,to_status,changed_by,reason)
    values(p_request_id,v_old,p_status,auth.uid(),p_reason);
  perform public.write_audit('REQUEST_STATUS_CHANGED','resource_request',p_request_id,
    jsonb_build_object('request_status',v_old),jsonb_build_object('request_status',p_status),p_reason);
end;
$$;

-- Private helper: approval and reservation use exactly the same eligibility rules.
-- Caller must lock the request and asset before calling this function.
create function public.renad_check_asset(p_request_id uuid, p_asset_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.resource_request; a public.asset;
begin
  select * into strict r from public.resource_request where request_id = p_request_id;
  select * into a from public.asset where asset_id = p_asset_id;
  if not found then raise exception 'Select an existing asset.' using errcode = '22023'; end if;
  if not a.is_published or a.asset_state <> 'Available' or a.available_quantity < r.quantity
    or a.category_id <> r.requested_category_id or a.condition not in ('Good','Fair') then
    raise exception 'Asset is no longer eligible or has insufficient available stock.' using errcode = '22023';
  end if;
  if r.preferred_condition is not null and btrim(r.preferred_condition) <> '' and
    (case a.condition when 'Good' then 3 when 'Fair' then 2 else 0 end) <
    (case r.preferred_condition when 'Good' then 3 when 'Fair' then 2 when 'Poor' then 1 else 4 end) then
    raise exception 'Asset does not meet the requested condition.' using errcode = '22023';
  end if;
  if not exists(select 1 from public.department where department_id=a.owning_department_id and is_active)
    or not exists(select 1 from public.department where department_id=r.requesting_department_id and is_active)
    or not exists(select 1 from public.app_user where user_id=r.submitted_by and account_status='active') then
    raise exception 'The requester and both departments must be active.' using errcode = '22023';
  end if;
end;
$$;

create function public.renad_start_review(p_request_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.resource_request;
begin
  perform public.renad_require_approver();
  select * into r from public.resource_request where request_id=p_request_id for update;
  if not found then raise exception 'Request not found.' using errcode='22023'; end if;
  if r.submitted_by=auth.uid() then raise exception 'You cannot review your own request.' using errcode='42501'; end if;
  if r.request_status='Under Review' then return; end if;
  if r.request_status<>'Submitted' then raise exception 'Only submitted requests can enter review.' using errcode='22023'; end if;
  perform public.renad_set_request_status(p_request_id,'Under Review','Approver started review');
end;
$$;

create function public.renad_decide_request(
  p_request_id uuid, p_decision text, p_asset_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.resource_request; v_id uuid;
begin
  perform public.renad_require_approver();
  if p_decision is null or p_decision not in ('Approved','Rejected','Returned for Information') then
    raise exception 'Choose a valid decision.' using errcode='22023'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'Enter a decision reason (1 to 1000 characters).' using errcode='22023'; end if;
  -- All workflow functions lock REQUEST first, then ASSET: a consistent lock order.
  select * into r from public.resource_request where request_id=p_request_id for update;
  if not found then raise exception 'Request not found.' using errcode='22023'; end if;
  if r.submitted_by=auth.uid() then raise exception 'You cannot approve or reject your own request.' using errcode='42501'; end if;
  if r.request_status<>'Under Review' then raise exception 'Start review before recording a decision.' using errcode='22023'; end if;
  if p_decision='Approved' then
    perform 1 from public.asset where asset_id=p_asset_id for update;
    perform public.renad_check_asset(p_request_id,p_asset_id);
  end if;
  insert into public.approval(approval_type,approver_id,request_id,asset_id,decision,approved_quantity,reason)
    values('Request',auth.uid(),p_request_id,
      case when p_decision='Approved' then p_asset_id end,p_decision,
      case when p_decision='Approved' then r.quantity end,btrim(p_reason)) returning approval_id into v_id;
  perform public.renad_set_request_status(p_request_id,p_decision,btrim(p_reason));
  perform public.write_audit('REQUEST_DECIDED','approval',v_id,null,
    jsonb_build_object('request_id',p_request_id,'decision',p_decision,'asset_id',p_asset_id),btrim(p_reason));
  -- Approval authorizes allocation; stock is NOT changed here.
  return v_id;
end;
$$;

create function public.renad_reserve_asset(p_request_id uuid, p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r public.resource_request; a public.asset; ap public.approval; v_id uuid; v_available integer;
begin
  perform public.renad_require_approver();
  select * into r from public.resource_request where request_id=p_request_id for update;
  if not found then raise exception 'Request not found.' using errcode='22023'; end if;
  if r.submitted_by=auth.uid() then raise exception 'You cannot allocate stock to your own request.' using errcode='42501'; end if;
  -- A retry must not subtract stock twice.
  if r.request_status='Reserved' then
    select reservation_id into v_id from public.reservation
      where request_id=p_request_id and reservation_status='Active';
    if v_id is not null then return v_id; end if;
  end if;
  if r.request_status<>'Approved' then raise exception 'Only approved requests can reserve stock.' using errcode='22023'; end if;
  if p_expires_at is null or p_expires_at<=clock_timestamp() then
    raise exception 'Choose a future reservation expiry.' using errcode='22023'; end if;
  select * into ap from public.approval where request_id=p_request_id
    order by decided_at desc,approval_id desc limit 1;
  if not found or ap.decision<>'Approved' or ap.approved_quantity is distinct from r.quantity
    or ap.approver_id=r.submitted_by then
    raise exception 'A valid approval is required.' using errcode='22023'; end if;
  select * into a from public.asset where asset_id=ap.asset_id for update;
  perform public.renad_check_asset(p_request_id,ap.asset_id);
  -- The row lock serializes contenders for the last unit; the second sees updated stock.
  v_available:=a.available_quantity-r.quantity;
  update public.asset set available_quantity=v_available,
    asset_state=case when v_available=0 then 'Reserved' else 'Available' end,
    is_published=(v_available>0) where asset_id=a.asset_id;
  insert into public.reservation(request_id,asset_id,approval_id,reserved_by,reserved_quantity,
    expires_at,reservation_status)
    values(p_request_id,a.asset_id,ap.approval_id,auth.uid(),r.quantity,p_expires_at,'Active')
    returning reservation_id into v_id;
  perform public.renad_set_request_status(p_request_id,'Reserved','Approved quantity reserved');
  insert into public.asset_history_event(asset_id,event_type,previous_state,new_state,details,performed_by)
    values(a.asset_id,'RESERVED',a.asset_state,case when v_available=0 then 'Reserved' else 'Available' end,
      'Reserved '||r.quantity||' units for request '||p_request_id,auth.uid());
  perform public.write_audit('ASSET_RESERVED','reservation',v_id,null,
    jsonb_build_object('request_id',p_request_id,'asset_id',a.asset_id,'quantity',r.quantity,'expires_at',p_expires_at));
  return v_id;
end;
$$;

-- Normal UI path: approval is followed automatically by reservation (Phase 3 UC-06).
-- Both calls run in one transaction: a failed reservation rolls the decision back too.
create function public.renad_approve_and_reserve(
  p_request_id uuid,p_asset_id uuid,p_reason text,p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  perform public.renad_decide_request(p_request_id,'Approved',p_asset_id,p_reason);
  return public.renad_reserve_asset(p_request_id,p_expires_at);
end;
$$;

-- Release a hold before transfer. Expiry returns the request to Approved;
-- cancellation ends the request. These are NOT physical asset release operations.
create function public.renad_end_reservation(p_request_id uuid,p_expired boolean,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare r public.resource_request; h public.reservation; a public.asset; v_state text;
begin
  perform public.renad_require_approver();
  if p_expired is null or p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then
    raise exception 'Enter a reason (1 to 1000 characters).' using errcode='22023'; end if;
  select * into r from public.resource_request where request_id=p_request_id for update;
  if not found then raise exception 'Request not found.' using errcode='22023'; end if;
  if r.submitted_by=auth.uid() then raise exception 'Another approver must manage this allocation.' using errcode='42501'; end if;
  if r.request_status not in ('Approved','Reserved') then
    raise exception 'Only approved or reserved requests can be cancelled or expired.' using errcode='22023'; end if;
  if exists(select 1 from public.transfer where request_id=p_request_id and transfer_status<>'Cancelled') then
    raise exception 'Use the transfer workflow once a transfer has been created.' using errcode='22023'; end if;
  select * into h from public.reservation where request_id=p_request_id and reservation_status='Active' for update;
  if found then
    if p_expired and h.expires_at>clock_timestamp() then
      raise exception 'This reservation has not expired.' using errcode='22023'; end if;
    select * into a from public.asset where asset_id=h.asset_id for update;
    -- Preserve an inspection/maintenance restriction if it was applied while stock was held.
    v_state:=case when a.asset_state='Reserved' then 'Available' else a.asset_state end;
    update public.asset set available_quantity=available_quantity+h.reserved_quantity,
      asset_state=v_state,is_published=(v_state='Available') where asset_id=a.asset_id;
    update public.reservation set reservation_status=case when p_expired then 'Expired' else 'Cancelled' end
      where reservation_id=h.reservation_id;
    insert into public.asset_history_event(asset_id,event_type,previous_state,new_state,details,performed_by)
      values(a.asset_id,case when p_expired then 'RESERVATION_EXPIRED' else 'RESERVATION_CANCELLED' end,
        a.asset_state,v_state,btrim(p_reason),auth.uid());
    perform public.write_audit('RESERVATION_ENDED','reservation',h.reservation_id,
      jsonb_build_object('reservation_status','Active'),
      jsonb_build_object('reservation_status',case when p_expired then 'Expired' else 'Cancelled' end),btrim(p_reason));
  elsif p_expired then
    raise exception 'No active reservation to expire.' using errcode='22023';
  end if;
  perform public.renad_set_request_status(p_request_id,case when p_expired then 'Approved' else 'Cancelled' end,btrim(p_reason));
end;
$$;

-- Approver-only workspace. No broad SELECT grants on requests or recommendations.
create function public.renad_approval_workspace() returns jsonb
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
        and (nullif(btrim(r.preferred_condition),'') is null or
          (case a.condition when 'Good' then 3 when 'Fair' then 2 else 0 end)>=
          (case r.preferred_condition when 'Good' then 3 when 'Fair' then 2 when 'Poor' then 1 else 4 end))) as assets,
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

-- Helpers cannot be called directly by the browser or impersonate a workflow change.
revoke all on function public.renad_require_approver() from public,anon,authenticated;
revoke all on function public.renad_set_request_status(uuid,text,text) from public,anon,authenticated;
revoke all on function public.renad_check_asset(uuid,uuid) from public,anon,authenticated;
revoke all on function public.renad_approve_and_reserve(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke all on function public.renad_start_review(uuid) from public,anon,authenticated;
revoke all on function public.renad_decide_request(uuid,text,uuid,text) from public,anon,authenticated;
revoke all on function public.renad_reserve_asset(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.renad_end_reservation(uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.renad_approval_workspace() from public,anon,authenticated;
grant execute on function public.renad_approve_and_reserve(uuid,uuid,text,timestamptz),public.renad_start_review(uuid),public.renad_decide_request(uuid,text,uuid,text),
 public.renad_reserve_asset(uuid,timestamptz),public.renad_end_reservation(uuid,boolean,text),
 public.renad_approval_workspace() to authenticated;
commit;
