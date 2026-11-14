begin;

create function public.shaikha_read_matches(
  p_request_id uuid,
  p_ranking_run_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_run_id uuid;
  v_results jsonb;
begin
  if v_user_id is null or not exists (
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

  if not exists (
    select 1
    from public.resource_request rr
    where rr.request_id = p_request_id
      and rr.submitted_by = v_user_id
  ) then
    raise exception 'Request unavailable'
      using errcode = '42501';
  end if;

  v_run_id := p_ranking_run_id;

  if v_run_id is null then
    select m.ranking_run_id
      into v_run_id
    from public.match_recommendation m
    where m.request_id = p_request_id
    order by m.created_at desc, m.recommendation_id
    limit 1;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'recommendation_id', results.recommendation_id,
        'asset_id', results.asset_id,
        'name', results.name,
        'condition', results.condition,
        'available_quantity', results.available_quantity,
        'rank_position', results.rank_position,
        'compatibility_score', results.compatibility_score,
        'confidence', results.confidence,
        'explanation', results.explanation,
        'review_status', results.review_status,
        'review_reason', results.review_reason,
        'created_at', results.created_at
      )
      order by results.rank_position
    ),
    '[]'::jsonb
  )
  into v_results
  from (
    select
      m.recommendation_id,
      m.asset_id,
      a.name,
      a.condition,
      a.available_quantity,
      m.rank_position,
      m.compatibility_score,
      m.confidence,
      m.explanation,
      m.review_status,
      m.review_reason,
      m.created_at
    from public.match_recommendation m
    join public.asset a on a.asset_id = m.asset_id
    where m.request_id = p_request_id
      and m.ranking_run_id = v_run_id
    order by m.rank_position
    limit 5
  ) results;

  return jsonb_build_object(
    'ranking_run_id', v_run_id,
    'matches', v_results
  );
end;
$$;

revoke all on function public.shaikha_read_matches(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.shaikha_read_matches(uuid, uuid)
  to authenticated;

commit;