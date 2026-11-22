-- C4: categories and the current requester's latest 100 requests.
-- Save for review. Renad applies approved migrations once.

begin;

create function public.shaikha_request_workspace()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_department_name text;
  v_categories jsonb;
  v_requests jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign-in required'
      using errcode = '42501';
  end if;

  select d.name
    into v_department_name
  from public.app_user u
  join public.department d
    on d.department_id = u.department_id
  where u.user_id = v_user_id
    and u.account_status = 'active'
    and d.is_active = true;

  if v_department_name is null then
    raise exception 'Active profile and department required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.user_role ur
    join public.role r on r.role_id = ur.role_id
    where ur.user_id = v_user_id
      and r.role_name = 'requester'
  ) then
    raise exception 'Requester role required'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'category_id', c.category_id,
        'name', c.name
      )
      order by c.name
    ),
    '[]'::jsonb
  )
  into v_categories
  from public.asset_category c;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'request_id', q.request_id,
        'category', q.category_name,
        'specifications', q.specifications,
        'quantity', q.quantity,
        'purpose', q.purpose,
        'urgency', q.urgency,
        'preferred_condition', q.preferred_condition,
        'preferred_location', q.preferred_location,
        'required_date', q.required_date,
        'request_status', q.request_status,
        'created_at', q.created_at,
        'submitted_at', q.submitted_at,
        'history', (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'history_id', h.history_id,
                'from_status', h.from_status,
                'to_status', h.to_status,
                'changed_at', h.changed_at,
                'reason', h.reason
              )
              order by h.changed_at, h.history_id
            ),
            '[]'::jsonb
          )
          from public.request_status_history h
          where h.request_id = q.request_id
        )
      )
      order by q.created_at desc, q.request_id
    ),
    '[]'::jsonb
  )
  into v_requests
  from (
    select rr.*, c.name as category_name
    from public.resource_request rr
    join public.asset_category c
      on c.category_id = rr.requested_category_id
    -- Ownership is enforced here, not supplied by the browser.
    where rr.submitted_by = v_user_id
    order by rr.created_at desc, rr.request_id
    limit 100
  ) q;

  return jsonb_build_object(
    'department_name', v_department_name,
    'categories', v_categories,
    'requests', v_requests
  );
end;
$$;

revoke all on function public.shaikha_request_workspace()
  from public, anon, authenticated;

grant execute on function public.shaikha_request_workspace()
  to authenticated;

commit;