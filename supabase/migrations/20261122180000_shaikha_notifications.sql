-- C8: apply ONCE after the existing foundation/contract. No old migration reruns.
-- Submission hook only; Renad connects approval/rejection/receipt at successful
-- workflow commit points. See docs/SHAIKHA_C8_HANDOFF.md before integration.
begin;

create table public.shaikha_notification (
 notification_id uuid primary key default gen_random_uuid(),
 recipient_id uuid not null references public.app_user(user_id),
 event_type text not null check(event_type in ('submitted','approved','rejected','received')),
 source_event_id uuid not null,
 request_id uuid not null references public.resource_request(request_id),
 approval_id uuid references public.approval(approval_id),
 transfer_id uuid references public.transfer(transfer_id),
 event_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp(),
 read_at timestamptz,
 unique(recipient_id,event_type,source_event_id),
 check (
  (event_type='submitted' and source_event_id=request_id and approval_id is null and transfer_id is null) or
  (event_type in ('approved','rejected') and source_event_id=approval_id and approval_id is not null and transfer_id is null) or
  (event_type='received' and source_event_id=transfer_id and transfer_id is not null and approval_id is null)
 )
);
create index shaikha_notifications_recipient_order
 on public.shaikha_notification(recipient_id,created_at desc,notification_id desc);
create index shaikha_notifications_unread
 on public.shaikha_notification(recipient_id,created_at desc,notification_id desc) where read_at is null;
alter table public.shaikha_notification enable row level security;
-- RPC-only access. In particular, no client can insert an event or change its
-- recipient. RLS is also a safety boundary if table privileges are added later.
revoke all on table public.shaikha_notification from public,anon,authenticated,service_role;
create policy shaikha_notification_own_select on public.shaikha_notification
 for select to authenticated using(recipient_id=(select auth.uid()));

create function public.shaikha_notification_actor()
returns uuid language plpgsql stable security definer set search_path=''
as $$
declare v_user uuid := auth.uid();
begin
 if v_user is null or not exists (
  select 1 from public.app_user u
  join public.department d on d.department_id=u.department_id
  where u.user_id=v_user and u.account_status='active' and d.is_active
   and exists(select 1 from public.user_role ur join public.role r on r.role_id=ur.role_id
    where ur.user_id=u.user_id and r.role_name in ('requester','custodian','approver','admin'))
 ) then raise exception 'Active account, department and application role required' using errcode='42501'; end if;
 return v_user;
end;
$$;

-- PRIVATE producer. Caller supplies only an event type and authoritative source
-- ID, never a recipient, message, actor or destination URL. No client grants.
-- Use PERFORM inside Renad's SECURITY DEFINER workflow function after its checks
-- and successful state writes; failures roll the whole transaction back.
create function public.shaikha_emit_notification(p_event text,p_source_id uuid)
returns integer language plpgsql security definer set search_path=''
as $$
declare
 v_recipient uuid;
 v_request uuid;
 v_approval uuid;
 v_transfer uuid;
 v_at timestamptz;
 v_count integer;
begin
 if p_source_id is null or p_event is null or p_event not in ('submitted','approved','rejected','received') then
  raise exception 'Invalid notification event' using errcode='22023';
 end if;
 if p_event='submitted' then
  select q.submitted_by,q.request_id,q.submitted_at into v_recipient,v_request,v_at
  from public.resource_request q
  where q.request_id=p_source_id and q.request_status='Submitted' and q.submitted_at is not null;
 elsif p_event in ('approved','rejected') then
  select q.submitted_by,q.request_id,p.approval_id,p.decided_at
   into v_recipient,v_request,v_approval,v_at
  from public.approval p join public.resource_request q on q.request_id=p.request_id
  where p.approval_id=p_source_id and p.decided_at is not null
   and ((p_event='approved' and p.decision='Approved' and p.approver_id<>q.submitted_by
    and p.asset_id is not null and p.approved_quantity>0
    and q.request_status in ('Approved','Reserved','In Transfer','Fulfilled'))
    or (p_event='rejected' and p.decision='Rejected' and q.request_status='Rejected'));
 else
  select q.submitted_by,q.request_id,t.transfer_id,t.received_at
   into v_recipient,v_request,v_transfer,v_at
  from public.transfer t join public.resource_request q on q.request_id=t.request_id
  where t.transfer_id=p_source_id and t.transfer_status in ('Completed','Receipt Discrepancy')
   and t.received_at is not null and t.received_by is not null
   and t.received_quantity is not null and t.received_quantity between 0 and t.quantity;
 end if;
 if v_recipient is null then
  raise exception 'Notification source is missing or has not reached the required state' using errcode='22023';
 end if;
 insert into public.shaikha_notification(recipient_id,event_type,source_event_id,
  request_id,approval_id,transfer_id,event_at)
 values(v_recipient,p_event,p_source_id,v_request,v_approval,v_transfer,v_at)
 on conflict(recipient_id,event_type,source_event_id) do nothing;
 get diagnostics v_count=row_count;
 return v_count;
end;
$$;

-- No replay/backfill of old requests. The first valid submission of each request
-- is deduplicated by request ID. Resubmitting the same ID is not a new notice.
create function public.shaikha_notification_on_submission()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 if new.request_status='Submitted' and new.submitted_at is not null then
  if tg_op='INSERT' then
   perform public.shaikha_emit_notification('submitted',new.request_id);
  elsif old.request_status is distinct from 'Submitted' or old.submitted_at is null then
   perform public.shaikha_emit_notification('submitted',new.request_id);
  end if;
 end if;
 return new;
end;
$$;
create trigger shaikha_request_submission_notice
 after insert or update of request_status,submitted_at on public.resource_request
 for each row execute function public.shaikha_notification_on_submission();

create function public.shaikha_notification_inbox(
 p_filter text default 'all',p_before_created_at timestamptz default null,p_before_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path='' set timezone='UTC'
as $$
declare v_user uuid := public.shaikha_notification_actor(); v_result jsonb;
begin
 if p_filter is null or p_filter not in ('all','unread') or
  (p_before_created_at is null)<>(p_before_id is null) or
  (p_before_created_at is not null and not isfinite(p_before_created_at)) then
  raise exception 'Invalid inbox filter or cursor' using errcode='22023';
 end if;
 with bounded as materialized (
  select n.notification_id,n.event_type,n.request_id,n.approval_id,n.transfer_id,
   n.event_at,n.created_at,n.read_at
  from public.shaikha_notification n
  where n.recipient_id=v_user and (p_filter='all' or n.read_at is null)
   and (p_before_created_at is null or (n.created_at,n.notification_id)<(p_before_created_at,p_before_id))
  order by n.created_at desc,n.notification_id desc limit 51
 ), page as materialized (
  select * from bounded order by created_at desc,notification_id desc limit 50
 ), last_item as (
  select created_at,notification_id from page order by created_at,notification_id limit 1
 )
 select jsonb_build_object(
  'contract_version','c8-inbox-v1','filter',p_filter,'loaded_at',statement_timestamp(),
  'unread_count',(select count(*) from public.shaikha_notification n where n.recipient_id=v_user and n.read_at is null),
  'has_more',(select count(*)>50 from bounded),
  'next_cursor',case when (select count(*)>50 from bounded) then
   (select jsonb_build_object('created_at',created_at,'notification_id',notification_id) from last_item) else null end,
  'items',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.notification_id desc) from page p),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;
$$;

create function public.shaikha_mark_notification_read(p_notification_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_user uuid := public.shaikha_notification_actor(); v_count integer;
begin
 if p_notification_id is null then raise exception 'Notification ID required' using errcode='22023'; end if;
 update public.shaikha_notification set read_at=clock_timestamp()
 where notification_id=p_notification_id and recipient_id=v_user and read_at is null;
 get diagnostics v_count=row_count;
 -- Foreign, nonexistent and already-read IDs all return false; none can be edited.
 return v_count=1;
end;
$$;

revoke all on function public.shaikha_notification_actor() from public,anon,authenticated,service_role;
revoke all on function public.shaikha_emit_notification(text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.shaikha_notification_on_submission() from public,anon,authenticated,service_role;
revoke all on function public.shaikha_notification_inbox(text,timestamptz,uuid) from public,anon,authenticated,service_role;
revoke all on function public.shaikha_mark_notification_read(uuid) from public,anon,authenticated,service_role;
grant execute on function public.shaikha_notification_inbox(text,timestamptz,uuid) to authenticated;
grant execute on function public.shaikha_mark_notification_read(uuid) to authenticated;

commit;
