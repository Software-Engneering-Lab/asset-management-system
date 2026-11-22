-- Apply once after 20261116000100_renad_eligibility_fix.sql.
-- Adds operations and columns only. Existing holds and asset quantities are preserved.
begin;

alter table public.transfer
 add column expected_receiver_id uuid references public.app_user,
 add column receiving_custodian_id uuid references public.app_user,
 add column scheduled_by uuid references public.app_user,
 add column scheduled_at timestamptz,
 add column origin_location text,
 add column document_reference text,
 add column released_condition text,
 add column received_asset_id uuid unique references public.asset,
 add column created_at timestamptz not null default now();
alter table public.transfer_discrepancy add column receipt_snapshot jsonb;

-- Everyone using this module needs an active profile AND active department.
create function public.renad_active_user() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.app_user u join public.department d on d.department_id=u.department_id
  where u.user_id=auth.uid() and u.account_status='active' and d.is_active)
$$;
create function public.renad_can_send(p_asset uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select public.renad_active_user() and public.has_role('custodian') and exists(
  select 1 from public.asset where asset_id=p_asset and owning_department_id=public.current_department_id())
$$;
create function public.renad_can_receive(p_transfer public.transfer) returns boolean
language sql stable security definer set search_path='' as $$
 select public.renad_active_user() and public.has_role('requester')
  and p_transfer.expected_receiver_id=auth.uid()
  and p_transfer.receiving_department_id=public.current_department_id()
$$;
create function public.renad_can_view_transfer(p_transfer public.transfer) returns boolean
language sql stable security definer set search_path='' as $$
 select public.renad_active_user() and (
  public.has_role('approver') or public.has_role('admin') or public.renad_can_send(p_transfer.asset_id)
  or p_transfer.expected_receiver_id=auth.uid() or p_transfer.receiving_custodian_id=auth.uid()
  or exists(select 1 from public.resource_request where request_id=p_transfer.request_id and submitted_by=auth.uid()))
$$;

-- Private: all writers take locks in the same order: request -> transfer -> hold -> asset.
create function public.renad_lock_transfer(p_id uuid) returns public.transfer
language plpgsql security definer set search_path='' as $$
declare t public.transfer; request_value uuid;
begin
 select request_id into request_value from public.transfer where transfer_id=p_id;
 if not found then raise exception 'Transfer not found.' using errcode='22023'; end if;
 perform 1 from public.resource_request where request_id=request_value for update;
 select * into strict t from public.transfer where transfer_id=p_id for update;
 perform 1 from public.reservation where reservation_id=t.reservation_id for update;
 perform 1 from public.asset where asset_id=t.asset_id for update;
 return t;
end; $$;

-- Private: status history lives in the append-only audit log and linked asset history.
create function public.renad_transfer_event(p_id uuid,p_before jsonb,p_previous_asset_state text,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.transfer; current_state text;
begin
 select * into strict t from public.transfer where transfer_id=p_id;
 select asset_state into current_state from public.asset where asset_id=t.asset_id;
 perform public.write_audit('TRANSFER_'||upper(replace(t.transfer_status,' ','_')),'transfer',p_id,
  p_before,to_jsonb(t),p_reason);
 insert into public.asset_history_event(asset_id,transfer_id,event_type,previous_state,new_state,details,performed_by)
 values(t.asset_id,p_id,'TRANSFER_'||upper(replace(t.transfer_status,' ','_')),
  p_previous_asset_state,current_state,p_reason,auth.uid());
end; $$;

create function public.renad_create_transfer(p_reservation uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare h public.reservation; q public.resource_request; a public.asset; ap public.approval; result uuid;
begin
 select * into h from public.reservation where reservation_id=p_reservation;
 if not found then raise exception 'Reservation not found.' using errcode='22023'; end if;
 select * into strict q from public.resource_request where request_id=h.request_id for update;
 select * into strict h from public.reservation where reservation_id=p_reservation for update;
 select * into strict a from public.asset where asset_id=h.asset_id for update;
 if public.renad_can_send(a.asset_id) is not true then
  raise exception 'Only a custodian of the sending department can arrange this transfer.' using errcode='42501'; end if;
 select transfer_id into result from public.transfer where reservation_id=p_reservation;
 if found then return result; end if; -- safe retry: never duplicate a handover
 select * into strict ap from public.approval where approval_id=h.approval_id;
 if q.request_status<>'Reserved' or h.reservation_status<>'Active' or h.expires_at<=statement_timestamp()
 or ap.decision<>'Approved' or ap.request_id<>q.request_id or ap.asset_id is distinct from a.asset_id
 or ap.approver_id=q.submitted_by or ap.approved_quantity is distinct from h.reserved_quantity
 or h.reserved_quantity<>q.quantity then
  raise exception 'An unexpired reservation and valid approval are required.' using errcode='22023'; end if;
 insert into public.transfer(request_id,asset_id,approval_id,approver_id,reservation_id,
  sending_department_id,receiving_department_id,quantity,transfer_status,origin_location,reason)
 values(q.request_id,a.asset_id,ap.approval_id,ap.approver_id,h.reservation_id,
  a.owning_department_id,q.requesting_department_id,h.reserved_quantity,'Approved',a.location,q.purpose)
 returning transfer_id into result;
 perform public.renad_transfer_event(result,null,a.asset_state,'Transfer created from the existing approved hold');
 return result;
end; $$;

create function public.renad_schedule_transfer(p_transfer uuid,p_date date,p_destination text,
 p_receiver uuid,p_custodian uuid,p_notes text,p_cost numeric,p_document text)
returns void language plpgsql security definer set search_path='' as $$
declare t public.transfer; h public.reservation; a public.asset;
begin
 t:=public.renad_lock_transfer(p_transfer);
 if public.renad_can_send(t.asset_id) is not true then
  raise exception 'Only a sending-department custodian can schedule handover.' using errcode='42501'; end if;
 if t.transfer_status not in ('Approved','Scheduled') then
  raise exception 'Only an approved or scheduled transfer can be arranged.' using errcode='22023'; end if;
 select * into strict h from public.reservation where reservation_id=t.reservation_id;
 select * into strict a from public.asset where asset_id=t.asset_id;
 if h.reservation_status<>'Active' or h.expires_at<=statement_timestamp() then
  raise exception 'The hold has expired. Do not release it.' using errcode='22023'; end if;
 if p_date is null or p_date<(statement_timestamp() at time zone 'UTC')::date
 or p_date>(h.expires_at at time zone 'UTC')::date
 or p_destination is null or length(btrim(p_destination)) not between 1 and 150
 or p_notes is null or length(btrim(p_notes)) not between 1 and 2000
 or p_cost is null or p_cost<0 or p_cost>9999999999.99 or length(coalesce(p_document,''))>1000 then
  raise exception 'Enter a valid date before expiry, destination, arrangements and nonnegative cost.' using errcode='22023'; end if;
 -- Physical receipt must be confirmed by the named receiving representative.
 if p_receiver=auth.uid() or not exists(select 1 from public.app_user u
   join public.user_role ur on ur.user_id=u.user_id join public.role r on r.role_id=ur.role_id
   where u.user_id=p_receiver and u.department_id=t.receiving_department_id
   and u.account_status='active' and r.role_name='requester') then
  raise exception 'Select a different active requester in the receiving department.' using errcode='22023'; end if;
 if not exists(select 1 from public.app_user u join public.user_role ur on ur.user_id=u.user_id
  join public.role r on r.role_id=ur.role_id where u.user_id=p_custodian
  and u.department_id=t.receiving_department_id and u.account_status='active' and r.role_name='custodian') then
  raise exception 'Select an active custodian in the receiving department.' using errcode='22023'; end if;
 update public.transfer set transfer_status='Scheduled',collection_date=p_date,destination_location=btrim(p_destination),
  expected_receiver_id=p_receiver,receiving_custodian_id=p_custodian,arrangement_notes=btrim(p_notes),
  transfer_cost=p_cost,document_reference=nullif(btrim(p_document),''),origin_location=a.location,
  scheduled_by=auth.uid(),scheduled_at=now() where transfer_id=p_transfer;
 perform public.renad_transfer_event(p_transfer,to_jsonb(t),a.asset_state,'Handover arrangements recorded');
end; $$;

create function public.renad_release_transfer(p_transfer uuid) returns void
language plpgsql security definer set search_path='' as $$
declare t public.transfer; h public.reservation; q public.resource_request; a public.asset; ap public.approval; problem text;
begin
 t:=public.renad_lock_transfer(p_transfer);
 if public.renad_can_send(t.asset_id) is not true then
  raise exception 'Only a sending-department custodian can release this asset.' using errcode='42501'; end if;
 if t.transfer_status<>'Scheduled' then raise exception 'Transfer must be Scheduled and not previously released.' using errcode='22023'; end if;
 select * into strict h from public.reservation where reservation_id=t.reservation_id;
 select * into strict q from public.resource_request where request_id=t.request_id;
 select * into strict a from public.asset where asset_id=t.asset_id;
 select * into strict ap from public.approval where approval_id=t.approval_id;
 if q.request_status<>'Reserved' or h.reservation_status<>'Active' or h.expires_at<=statement_timestamp()
 or ap.decision<>'Approved' or ap.approver_id=q.submitted_by or ap.approver_id<>t.approver_id
 or ap.request_id<>q.request_id or ap.asset_id is distinct from a.asset_id
 or h.request_id<>q.request_id or h.asset_id<>a.asset_id or h.approval_id<>ap.approval_id
 or ap.approved_quantity is distinct from t.quantity or h.reserved_quantity<>t.quantity
 or a.owning_department_id<>t.sending_department_id or q.requesting_department_id<>t.receiving_department_id
 or t.collection_date>(statement_timestamp() at time zone 'UTC')::date then
  raise exception 'Approval, hold, departments or handover date are no longer valid.' using errcode='22023'; end if;
 perform 1 from public.shaikha_request_match_rules where request_id=t.request_id for share;
 perform 1 from public.shaikha_asset_match_evidence where request_id=t.request_id and asset_id=t.asset_id for share;
 problem:=public.renad_eligibility_problem(t.request_id,t.asset_id,true);
 if problem is not null then raise exception '%',problem using errcode='22023'; end if;
 if not exists(select 1 from public.app_user u join public.user_role ur on ur.user_id=u.user_id join public.role r on r.role_id=ur.role_id
  where u.user_id=t.expected_receiver_id and u.department_id=t.receiving_department_id and u.account_status='active' and r.role_name='requester')
 or t.expected_receiver_id=auth.uid() then raise exception 'Receiving representative is no longer eligible.' using errcode='22023'; end if;
 update public.reservation set reservation_status='Consumed' where reservation_id=h.reservation_id;
 update public.transfer set transfer_status='Released',released_by=auth.uid(),released_at=now(),released_condition=a.condition
  where transfer_id=p_transfer;
 -- Available stock was deducted on reservation. DO NOT deduct it again here.
 update public.asset set asset_state=case when available_quantity>0 then 'Available' else 'In Transfer' end,
  is_published=(available_quantity>0) where asset_id=a.asset_id;
 perform public.renad_set_request_status(q.request_id,'In Transfer','Sending custodian released the approved units');
 perform public.renad_transfer_event(p_transfer,to_jsonb(t),a.asset_state,'Physical handover recorded');
end; $$;

create function public.renad_cancel_transfer(p_transfer uuid,p_expired boolean,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.transfer; a public.asset;
begin
 perform public.renad_require_approver();
 t:=public.renad_lock_transfer(p_transfer);
 if t.transfer_status not in ('Approved','Scheduled') then
  raise exception 'After release, use the discrepancy process instead of cancellation.' using errcode='22023'; end if;
 select * into strict a from public.asset where asset_id=t.asset_id;
 -- Mark cancelled first so the existing hold-ending function permits this operation.
 -- If its validation fails, this UPDATE rolls back with the rest of the transaction.
 update public.transfer set transfer_status='Cancelled' where transfer_id=p_transfer;
 perform public.renad_end_reservation(t.request_id,p_expired,p_reason);
 perform public.renad_transfer_event(p_transfer,to_jsonb(t),a.asset_state,p_reason);
end; $$;

create function public.renad_resolve_discrepancy(p_discrepancy uuid,p_resolution text) returns void
language plpgsql security definer set search_path='' as $$
declare t public.transfer; d public.transfer_discrepancy; transfer_value uuid;
begin
 perform public.renad_require_approver();
 select transfer_id into transfer_value from public.transfer_discrepancy where discrepancy_id=p_discrepancy;
 if not found then raise exception 'Discrepancy not found.' using errcode='22023'; end if;
 t:=public.renad_lock_transfer(transfer_value);
 if exists(select 1 from public.resource_request where request_id=t.request_id and submitted_by=auth.uid()) then
  raise exception 'Another approver must resolve your own request.' using errcode='42501'; end if;
 select * into strict d from public.transfer_discrepancy where discrepancy_id=p_discrepancy for update;
 if t.transfer_status<>'Receipt Discrepancy' or d.resolved_at is not null then
  raise exception 'This discrepancy is already resolved or the transfer is closed.' using errcode='22023'; end if;
 if p_resolution is null or length(btrim(p_resolution)) not between 1 and 2000 then
  raise exception 'Record what was done to resolve the discrepancy.' using errcode='22023'; end if;
 update public.transfer_discrepancy set resolution=btrim(p_resolution),resolved_by=auth.uid(),resolved_at=now()
  where discrepancy_id=p_discrepancy;
 perform public.write_audit('DISCREPANCY_RESOLVED','transfer_discrepancy',p_discrepancy,to_jsonb(d),
  jsonb_build_object('resolution',btrim(p_resolution),'transfer_id',transfer_value),p_resolution);
 -- Resolution does NOT complete a transfer; the receiver must confirm again.
end; $$;

create function public.renad_receive_transfer(p_transfer uuid,p_quantity integer,p_condition text,
 p_location text,p_has_problem boolean,p_note text)
returns text language plpgsql security definer set search_path='' as $$
declare t public.transfer; a public.asset; child uuid; next_state text; problem boolean;
 source_state text; source_quantity integer; unresolved boolean;
begin
 t:=public.renad_lock_transfer(p_transfer);
 if public.renad_can_receive(t) is not true then
  raise exception 'Only the named receiving representative can confirm receipt.' using errcode='42501'; end if;
 if t.transfer_status not in ('Released','Receipt Discrepancy') then
  raise exception 'Transfer must be released and cannot already be completed.' using errcode='22023'; end if;
 if p_quantity is null or p_quantity<0 or p_quantity>t.quantity or p_condition is null
 or p_condition not in ('Good','Fair','Poor') or p_location is null or length(btrim(p_location)) not between 1 and 150
 or p_has_problem is null or length(coalesce(p_note,''))>2000 then
  raise exception 'Enter a valid total received quantity, condition and destination.' using errcode='22023'; end if;
 select * into strict a from public.asset where asset_id=t.asset_id;
 if not exists(select 1 from public.reservation where reservation_id=t.reservation_id and reservation_status='Consumed')
 or not exists(select 1 from public.resource_request where request_id=t.request_id and request_status='In Transfer') then
  raise exception 'Transfer/request/hold state is inconsistent.' using errcode='22023'; end if;
 select exists(select 1 from public.transfer_discrepancy where transfer_id=p_transfer and resolved_at is null) into unresolved;
 -- Changed condition/destination requires a recorded and resolved discrepancy.
 problem:=p_has_problem or p_quantity<>t.quantity
  or (p_condition is distinct from t.released_condition and not exists(select 1 from public.transfer_discrepancy
      where transfer_id=p_transfer and resolved_at is not null and receipt_snapshot->>'condition'=p_condition))
  or (btrim(p_location) is distinct from t.destination_location and not exists(select 1 from public.transfer_discrepancy
      where transfer_id=p_transfer and resolved_at is not null and receipt_snapshot->>'location'=btrim(p_location)));
 if problem then
  if p_note is null or length(btrim(p_note))=0 then
   raise exception 'Describe the quantity, condition, destination or other discrepancy.' using errcode='22023'; end if;
  if exists(select 1 from public.transfer_discrepancy where transfer_id=p_transfer and resolved_at is null
   and receipt_snapshot=jsonb_build_object('quantity',p_quantity,'condition',p_condition,'location',btrim(p_location))
   and description=btrim(p_note)) then return 'Receipt Discrepancy'; end if;
  insert into public.transfer_discrepancy(transfer_id,reported_by,discrepancy_type,description,receipt_snapshot)
   values(p_transfer,auth.uid(),'Receipt',btrim(p_note),jsonb_build_object('quantity',p_quantity,'condition',p_condition,'location',btrim(p_location)));
  update public.transfer set transfer_status='Receipt Discrepancy',received_quantity=p_quantity,
   received_condition=p_condition,received_by=auth.uid() where transfer_id=p_transfer;
  perform public.renad_transfer_event(p_transfer,to_jsonb(t),a.asset_state,'Receipt discrepancy: '||btrim(p_note));
  -- No ownership/stock change on partial or unresolved receipt.
  return 'Receipt Discrepancy';
 end if;
 if unresolved then raise exception 'An approver must resolve all discrepancies before you confirm receipt again.' using errcode='22023'; end if;
 if not exists(select 1 from public.app_user u join public.user_role ur on ur.user_id=u.user_id join public.role r on r.role_id=ur.role_id
  where u.user_id=t.receiving_custodian_id and u.department_id=t.receiving_department_id
  and u.account_status='active' and r.role_name='custodian') then
  raise exception 'Receiving custodian is no longer active; resolve the assignment before completion.' using errcode='22023'; end if;
 if a.quantity<t.quantity or a.quantity-t.quantity<a.available_quantity then
  raise exception 'Source quantities are inconsistent; completion was not saved.' using errcode='22023'; end if;
 next_state:=case when p_condition='Poor' or a.asset_state not in ('Available','Reserved','In Transfer') then 'Unavailable' else 'Registered' end;
 -- Phase 4-5 D3: received units get their own row, linked to the original batch.
 insert into public.asset(name,description,category_id,quantity,available_quantity,purchase_date,estimated_value,
  owning_department_id,custodian_id,location,condition,asset_state,is_published,material_type,weight_kg,
  expected_end_of_life,source_asset_id)
 values(a.name,a.description,a.category_id,t.quantity,t.quantity,a.purchase_date,a.estimated_value,
  t.receiving_department_id,t.receiving_custodian_id,btrim(p_location),p_condition,next_state,false,
  a.material_type,a.weight_kg,a.expected_end_of_life,a.asset_id) returning asset_id into child;
 source_quantity:=a.quantity-t.quantity;
 source_state:=case
  when source_quantity=0 then 'Unavailable'
  when a.asset_state not in ('Available','Reserved','In Transfer') then a.asset_state
  when a.available_quantity>0 then 'Available'
  when exists(select 1 from public.reservation where asset_id=a.asset_id and reservation_status='Active') then 'Reserved'
  when exists(select 1 from public.transfer where asset_id=a.asset_id and transfer_id<>p_transfer
    and transfer_status in ('Released','Receipt Discrepancy')) then 'In Transfer'
  else 'Unavailable' end;
 update public.asset set quantity=source_quantity,asset_state=source_state,is_published=(source_state='Available') where asset_id=a.asset_id;
 update public.transfer set transfer_status='Completed',received_quantity=t.quantity,received_condition=p_condition,
  destination_location=btrim(p_location),received_by=auth.uid(),received_at=now(),received_asset_id=child where transfer_id=p_transfer;
 perform public.renad_set_request_status(t.request_id,'Fulfilled','Receiver confirmed all approved units; discrepancies resolved');
 perform public.renad_transfer_event(p_transfer,to_jsonb(t),a.asset_state,'Receipt confirmed; received units moved to asset '||child);
 insert into public.asset_history_event(asset_id,transfer_id,event_type,previous_state,new_state,details,performed_by)
  values(child,p_transfer,'RECEIVED',null,next_state,'Received from asset '||a.asset_id,auth.uid());
 perform public.write_audit('ASSET_BATCH_TRANSFERRED','asset',a.asset_id,to_jsonb(a),
  jsonb_build_object('remaining_quantity',source_quantity,'received_asset_id',child,
    'receiving_department',t.receiving_department_id,'custodian',t.receiving_custodian_id,'location',btrim(p_location)));
 return 'Completed';
end; $$;

-- A cancelled hold can restore free units while another batch unit is in transit.
-- Preserve restrictions, but make the restored, unrestricted remainder searchable.
create or replace function public.renad_end_reservation(p_request_id uuid,p_expired boolean,p_reason text)
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
    v_state:=case when a.asset_state in ('Reserved','In Transfer') then 'Available' else a.asset_state end;
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

-- A single permission-scoped read supplies the page; client tables remain protected by RLS.
create function public.renad_transfer_workspace() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare transfers jsonb; holds jsonb; checks jsonb; people jsonb;
begin
 if public.renad_active_user() is not true or not(public.has_role('requester') or public.has_role('custodian')
  or public.has_role('approver') or public.has_role('admin')) then
  raise exception 'An active application role and department are required.' using errcode='42501'; end if;
 select coalesce(jsonb_agg(item order by created_at desc),'[]'::jsonb) into transfers from (
  select t.created_at,to_jsonb(t)||jsonb_build_object(
   'asset_name',a.name,'sending_department',sd.name,'receiving_department',rd.name,
   'receiver',receiver.full_name,'custodian',custodian.full_name,'expires_at',h.expires_at,
   'can_send',public.renad_can_send(t.asset_id),'can_receive',public.renad_can_receive(t),
   'can_approve',(public.has_role('approver') or public.has_role('admin')) and q.submitted_by<>auth.uid(),
   'history',(select coalesce(jsonb_agg(jsonb_build_object('action',l.action,'at',l.occurred_at,
    'actor',u.full_name,'reason',l.reason) order by l.occurred_at,l.audit_id),'[]'::jsonb)
    from public.audit_log l join public.app_user u on u.user_id=l.actor_id
    where l.record_type='transfer' and l.record_id=t.transfer_id),
   'discrepancies',(select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('reporter',r.full_name,'resolver',v.full_name)
     order by d.reported_at,d.discrepancy_id),'[]'::jsonb) from public.transfer_discrepancy d
     join public.app_user r on r.user_id=d.reported_by left join public.app_user v on v.user_id=d.resolved_by
     where d.transfer_id=t.transfer_id)) item
  from public.transfer t join public.asset a on a.asset_id=t.asset_id
  join public.resource_request q on q.request_id=t.request_id
  join public.reservation h on h.reservation_id=t.reservation_id
  join public.department sd on sd.department_id=t.sending_department_id
  join public.department rd on rd.department_id=t.receiving_department_id
  left join public.app_user receiver on receiver.user_id=t.expected_receiver_id
  left join public.app_user custodian on custodian.user_id=t.receiving_custodian_id
  where public.renad_can_view_transfer(t) order by t.created_at desc,t.transfer_id limit 100
 ) rows;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into holds from (
  select jsonb_build_object('reservation_id',h.reservation_id,'request_id',q.request_id,'asset_name',a.name,
   'quantity',h.reserved_quantity,'expires_at',h.expires_at,'receiving_department',d.name) item
  from public.reservation h join public.resource_request q on q.request_id=h.request_id
  join public.asset a on a.asset_id=h.asset_id join public.department d on d.department_id=q.requesting_department_id
  where public.renad_can_send(a.asset_id) and h.reservation_status='Active' and h.expires_at>statement_timestamp()
  and q.request_status='Reserved' and not exists(select 1 from public.transfer where reservation_id=h.reservation_id)
  order by h.created_at,h.reservation_id limit 100
 ) rows;
 -- Requesters see their own requirements. Custodians see relevant requests and only their own department's assets.
 select coalesce(jsonb_agg(item),'[]'::jsonb) into checks from (
  select jsonb_build_object('request_id',q.request_id,'specifications',q.specifications,'quantity',q.quantity,
   'status',q.request_status,'required_date',q.required_date,'can_confirm',q.submitted_by=auth.uid() and public.has_role('requester'),
   'mandatory',coalesce(r.mandatory_requirements,'[]'::jsonb),'preferred',coalesce(r.preferred_requirements,'[]'::jsonb),
   'assets',(select coalesce(jsonb_agg(jsonb_build_object('asset_id',a.asset_id,'name',a.name,'description',a.description,
     'location',a.location,'condition',a.condition,'problem',public.renad_eligibility_problem(q.request_id,a.asset_id,q.request_status='Reserved'))
     order by a.name,a.asset_id),'[]'::jsonb)
     from public.asset a where a.category_id=q.requested_category_id
     and (public.renad_can_send(a.asset_id) or public.has_role('admin'))
     and ((a.is_published and a.asset_state='Available') or exists(select 1 from public.reservation h
       where h.request_id=q.request_id and h.asset_id=a.asset_id and h.reservation_status='Active')))) item
  from public.resource_request q left join public.shaikha_request_match_rules r on r.request_id=q.request_id
  where q.request_status in ('Submitted','Under Review','Approved','Reserved') and
   (q.submitted_by=auth.uid() or public.has_role('admin') or exists(select 1 from public.asset a
    where a.category_id=q.requested_category_id and public.renad_can_send(a.asset_id)
    and (a.is_published or exists(select 1 from public.reservation h where h.request_id=q.request_id and h.asset_id=a.asset_id and h.reservation_status='Active'))))
  order by q.created_at,q.request_id limit 100
 ) rows;
 -- Only names/roles from receiving departments involved in this sender's transfers.
 select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'name',u.full_name,'department_id',u.department_id,
   'roles',(select jsonb_agg(r.role_name) from public.user_role ur join public.role r on r.role_id=ur.role_id where ur.user_id=u.user_id))),'[]'::jsonb)
 into people from public.app_user u join public.department d on d.department_id=u.department_id
 where u.account_status='active' and d.is_active and exists(select 1 from public.transfer t
   where t.receiving_department_id=u.department_id and public.renad_can_send(t.asset_id) and t.transfer_status in ('Approved','Scheduled'));
 return jsonb_build_object('transfers',transfers,'holds',holds,'checks',checks,'people',people);
end; $$;

-- SECURITY DEFINER functions are not public APIs unless explicitly granted below.
revoke all on function public.renad_active_user(),public.renad_can_send(uuid),public.renad_can_receive(public.transfer),
 public.renad_can_view_transfer(public.transfer),public.renad_lock_transfer(uuid),public.renad_transfer_event(uuid,jsonb,text,text),
 public.renad_create_transfer(uuid),public.renad_schedule_transfer(uuid,date,text,uuid,uuid,text,numeric,text),
 public.renad_release_transfer(uuid),public.renad_cancel_transfer(uuid,boolean,text),
 public.renad_resolve_discrepancy(uuid,text),public.renad_receive_transfer(uuid,integer,text,text,boolean,text),
 public.renad_transfer_workspace() from public,anon,authenticated;
grant execute on function public.renad_create_transfer(uuid),
 public.renad_schedule_transfer(uuid,date,text,uuid,uuid,text,numeric,text),public.renad_release_transfer(uuid),
 public.renad_cancel_transfer(uuid,boolean,text),public.renad_resolve_discrepancy(uuid,text),
 public.renad_receive_transfer(uuid,integer,text,text,boolean,text),public.renad_transfer_workspace() to authenticated;
commit;
