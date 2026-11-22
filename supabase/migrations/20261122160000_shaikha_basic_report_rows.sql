-- C9: bounded, admin-only basic request/transfer reports.
-- REVIEW and apply ONCE after the foundation/contract and Shaikha's AI5 007.
-- No existing table grants, policies, workflow functions or applied files change.
begin;

do $$ begin
 if to_regprocedure('public.shaikha_report_admin(uuid)') is null then
  raise exception 'Requires the already-reviewed AI5 reports migration (007). Do not rerun it if applied.';
 end if;
end $$;

create index shaikha_c9_requests_created
 on public.resource_request(created_at desc, request_id desc);
create index shaikha_c9_approval_decided
 on public.approval(decided_at desc, approval_id);
create index shaikha_c9_transfer_approval
 on public.transfer(approval_id);

create function public.shaikha_basic_report_rows(
 p_kind text,
 p_period_start date,
 p_period_end date,
 p_status text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set timezone = 'UTC'
as $$
declare
 v_start timestamptz;
 v_end timestamptz;
 v_status text := nullif(p_status,'');
 v_rows jsonb;
 v_more boolean;
begin
 -- Authorize before checking filters or querying any report records.
 if auth.uid() is null or not public.shaikha_report_admin(auth.uid()) then
  raise exception 'Active admin profile, department and role required' using errcode='42501';
 end if;
 if p_kind is null or p_kind not in ('requests','transfers') or
 p_period_start is null or p_period_end is null or p_period_end<p_period_start or
 p_period_end-p_period_start>365 or extract(year from p_period_start)<1 or
 extract(year from p_period_end)>9999 then
  raise exception 'Invalid record type or dates; maximum 366 inclusive days' using errcode='22023';
 end if;
 if v_status is not null and (
  (p_kind='requests' and v_status not in ('Draft','Submitted','Under Review',
   'Returned for Information','Approved','Reserved','In Transfer','Fulfilled','Rejected','Cancelled')) or
  (p_kind='transfers' and v_status not in ('Approved','Scheduled','Released','Receipt Discrepancy','Completed','Cancelled'))
 ) then raise exception 'Invalid status for record type' using errcode='22023'; end if;

 v_start := p_period_start::timestamp at time zone 'UTC';
 v_end := (p_period_end+1)::timestamp at time zone 'UTC';

 -- A single bounded statement per report. The 1001st row detects overflow;
 -- the client must refuse full-export claims when has_more=true.
 if p_kind='requests' then
  with bounded as materialized (
   select q.request_id,q.created_at,q.submitted_at,d.name as department,
    c.name as category,q.quantity,q.urgency,q.request_status,q.purpose
   from public.resource_request q
   join public.department d on d.department_id=q.requesting_department_id
   join public.asset_category c on c.category_id=q.requested_category_id
   where q.created_at>=v_start and q.created_at<v_end
    and (v_status is null or q.request_status=v_status)
   order by q.created_at desc,q.request_id desc
   limit 1001
  ), page as (
   select * from bounded order by created_at desc,request_id desc limit 1000
  )
  select (select count(*)>1000 from bounded),
   coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.request_id desc) from page p),'[]'::jsonb)
  into v_more,v_rows;
 else
  -- The shared transfer table has NO created_at. Do not invent a date or
  -- alter Renad's table: explicitly use its linked approval decision time.
  with bounded as materialized (
   select t.transfer_id,t.request_id,t.asset_id,a.name as asset_name,
    ds.name as sending_department,dr.name as receiving_department,
    t.quantity,t.received_quantity,t.transfer_status,
    p.decided_at as approval_decided_at,t.released_at,t.received_at
   from public.transfer t
   join public.approval p on p.approval_id=t.approval_id
   join public.asset a on a.asset_id=t.asset_id
   join public.department ds on ds.department_id=t.sending_department_id
   join public.department dr on dr.department_id=t.receiving_department_id
   where p.decided_at>=v_start and p.decided_at<v_end
    and (v_status is null or t.transfer_status=v_status)
   order by p.decided_at desc,t.transfer_id desc
   limit 1001
  ), page as (
   select * from bounded order by approval_decided_at desc,transfer_id desc limit 1000
  )
  select (select count(*)>1000 from bounded),
   coalesce((select jsonb_agg(to_jsonb(p) order by p.approval_decided_at desc,p.transfer_id desc) from page p),'[]'::jsonb)
  into v_more,v_rows;
 end if;

 return jsonb_build_object(
  'contract_version','c9-basic-v1','kind',p_kind,
  'period_start',p_period_start,'period_end',p_period_end,'status',v_status,
  'generated_at',statement_timestamp(),'limit',1000,'has_more',v_more,
  'date_basis',case when p_kind='requests' then 'resource_request.created_at' else 'approval.decided_at' end,
  'rows',v_rows
 );
end;
$$;

revoke all on function public.shaikha_basic_report_rows(text,date,date,text)
 from public,anon,authenticated,service_role;
grant execute on function public.shaikha_basic_report_rows(text,date,date,text)
 to authenticated;

commit;
