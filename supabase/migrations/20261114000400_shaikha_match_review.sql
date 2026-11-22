-- AI2: ranking-run identifiers and authorized recommendation review.
-- Review before applying to the shared database.

begin;

-- Each new ranking operation must supply ONE shared UUID
-- for all recommendations generated in that operation.
alter table public.match_recommendation
  add column ranking_run_id uuid not null default gen_random_uuid();

create unique index match_rank_per_run
  on public.match_recommendation (
    request_id, ranking_run_id, rank_position
  );

create unique index match_asset_per_run
  on public.match_recommendation (
    request_id, ranking_run_id, asset_id
  );

create function public.shaikha_review_match(
  p_recommendation_id uuid,
  p_decision text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_request_id uuid;
  v_request public.resource_request%rowtype;
  v_match public.match_recommendation%rowtype;
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

  if p_decision is null
    or p_decision not in ('accepted', 'rejected')
  then
    raise exception 'Invalid review decision'
      using errcode = '22023';
  end if;

  if char_length(btrim(p_reason)) > 1000 then
    raise exception 'Review reason is too long'
      using errcode = '22023';
  end if;

  if p_decision = 'rejected'
    and nullif(btrim(p_reason), '') is null
  then
    raise exception 'A rejection reason is required'
      using errcode = '22023';
  end if;

  -- Discover only a recommendation belonging to this requester.
  select m.request_id
    into v_request_id
  from public.match_recommendation m
  join public.resource_request rr
    on rr.request_id = m.request_id
  where m.recommendation_id = p_recommendation_id
    and rr.submitted_by = v_user_id;

  if not found then
    raise exception 'Recommendation unavailable'
      using errcode = '42501';
  end if;

  -- Serialize review against changes to this request.
  select rr.*
    into v_request
  from public.resource_request rr
  where rr.request_id = v_request_id
    and rr.submitted_by = v_user_id
  for update;

  if not found then
    raise exception 'Request unavailable'
      using errcode = '42501';
  end if;

  if v_request.request_status not in ('Submitted', 'Under Review') then
    raise exception 'This request can no longer review matches'
      using errcode = '22023';
  end if;

  select m.*
    into v_match
  from public.match_recommendation m
  where m.recommendation_id = p_recommendation_id
    and m.request_id = v_request_id
  for update;

  if not found then
    raise exception 'Recommendation unavailable'
      using errcode = '42501';
  end if;

  -- Repeated identical decisions do not duplicate audit records.
  if v_match.review_status = p_decision then
    return v_match.recommendation_id;
  end if;

  -- Keep completed review decisions as history.
  if v_match.review_status <> 'pending' then
    raise exception 'This recommendation was already reviewed'
      using errcode = '22023';
  end if;

  -- Acceptance requires the asset still to be eligible.
  -- This check does NOT reserve stock.
  if p_decision = 'accepted' then
    perform a.asset_id
    from public.asset a
    join public.department d
      on d.department_id = a.owning_department_id
    where a.asset_id = v_match.asset_id
      and a.is_published = true
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
    for share of a, d;

    if not found then
      raise exception 'Asset no longer eligible; refresh matches'
        using errcode = '22023';
    end if;
  end if;

  update public.match_recommendation
  set
    review_status = p_decision,
    reviewed_by = v_user_id,
    review_reason = nullif(btrim(p_reason), ''),
    reviewed_at = now()
  where recommendation_id = p_recommendation_id;

  insert into public.audit_log (
    actor_id,
    action,
    record_type,
    record_id,
    previous_value,
    new_value,
    reason,
    model_version_id
  )
  values (
    v_user_id,
    'match_reviewed',
    'match_recommendation',
    p_recommendation_id,
    jsonb_build_object('review_status', v_match.review_status),
    jsonb_build_object('review_status', p_decision),
    nullif(btrim(p_reason), ''),
    v_match.model_version_id
  );

  return p_recommendation_id;
end;
$$;

revoke all on function public.shaikha_review_match(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.shaikha_review_match(uuid, text, text)
  to authenticated;

commit;