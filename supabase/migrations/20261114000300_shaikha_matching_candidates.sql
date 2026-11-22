-- AI2: retrieve eligible candidates for an owned request.
-- Save for team review; do not execute yet.
--
-- Proposed eligibility convention:
-- Published, Available, sufficient stock, same category,
-- active owning department, and Good/Fair condition.
-- Preferred condition is treated as a minimum condition.
-- Confirm these rules with the team before applying.

begin;

create function public.shaikha_matching_candidates(
  p_request_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request public.resource_request%rowtype;
  v_candidates jsonb;
  v_total integer;
begin
  if v_user_id is null then
    raise exception 'Sign-in required'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.app_user u
    join public.department d
      on d.department_id = u.department_id
    join public.user_role ur
      on ur.user_id = u.user_id
    join public.role r
      on r.role_id = ur.role_id
    where u.user_id = v_user_id
      and u.account_status = 'active'
      and d.is_active = true
      and r.role_name = 'requester'
  ) then
    raise exception 'Active requester profile required'
      using errcode = '42501';
  end if;

  select rr.*
    into v_request
  from public.resource_request rr
  where rr.request_id = p_request_id
    and rr.submitted_by = v_user_id;

  if not found then
    raise exception 'Request unavailable'
      using errcode = '42501';
  end if;

  if v_request.request_status not in ('Submitted', 'Under Review') then
    raise exception 'Matching is unavailable for this request status'
      using errcode = '22023';
  end if;

  with eligible as (
    select
      a.asset_id,
      a.name,
      a.description,
      a.condition,
      a.available_quantity,
      a.location,
      a.created_at
    from public.asset a
    join public.department d
      on d.department_id = a.owning_department_id
    where a.is_published = true
      and a.asset_state = 'Available'
      and a.available_quantity >= v_request.quantity
      and a.category_id = v_request.requested_category_id
      and d.is_active = true
      and a.condition in ('Good', 'Fair')
      and (
        nullif(btrim(v_request.preferred_condition), '') is null
        or (
          case a.condition
            when 'Good' then 3
            when 'Fair' then 2
            else 0
          end
          >=
          case v_request.preferred_condition
            when 'Good' then 3
            when 'Fair' then 2
            when 'Poor' then 1
            else 4
          end
        )
      )
  ),
  shortlist as (
    select *
    from eligible
    order by
      case condition when 'Good' then 0 else 1 end,
      created_at desc,
      asset_id
    limit 25
  )
  select
    (select count(*)::integer from eligible),
    (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'asset_id', s.asset_id,
            'name', s.name,
            'description', s.description,
            'condition', s.condition,
            'available_quantity', s.available_quantity,
            'location', s.location
          )
          order by
            case s.condition when 'Good' then 0 else 1 end,
            s.created_at desc,
            s.asset_id
        ),
        '[]'::jsonb
      )
      from shortlist s
    )
  into v_total, v_candidates;

  return jsonb_build_object(
    'request_id', v_request.request_id,
    'specifications', v_request.specifications,
    'quantity', v_request.quantity,
    'eligible_total', v_total,
    'candidate_limit', 25,
    'candidates', v_candidates
  );
end;
$$;

revoke all on function public.shaikha_matching_candidates(uuid)
  from public, anon, authenticated;

grant execute on function public.shaikha_matching_candidates(uuid)
  to authenticated;

commit;