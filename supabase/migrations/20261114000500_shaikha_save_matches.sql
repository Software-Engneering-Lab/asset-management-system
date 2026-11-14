-- AI2: persist server-generated recommendations.
-- Only the service_role can execute this operation.
-- Requester review uses the separate authenticated review function.

begin;

create function public.shaikha_save_matches(
  p_actor_id uuid,
  p_request_id uuid,
  p_ranking_run_id uuid,
  p_model_name text,
  p_model_version text,
  p_specifications_snapshot text,
  p_matches jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.resource_request%rowtype;
  v_model_id uuid;
  v_item jsonb;
  v_asset_id uuid;
  v_score numeric;
  v_reason text;
  v_position integer := 0;
  v_count integer;
begin
  -- The browser's authenticated/publishable-key client cannot save AI results.
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server operation required'
      using errcode = '42501';
  end if;

  if p_actor_id is null
    or p_request_id is null
    or p_ranking_run_id is null
  then
    raise exception 'Missing identifiers'
      using errcode = '22023';
  end if;

  if nullif(btrim(p_model_name), '') is null
    or char_length(p_model_name) > 80
    or nullif(btrim(p_model_version), '') is null
    or char_length(p_model_version) > 80
  then
    raise exception 'Invalid model metadata'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_matches) is distinct from 'array' then
    raise exception 'Matches must be an array'
      using errcode = '22023';
  end if;

  v_count := jsonb_array_length(p_matches);

  if v_count < 1 or v_count > 5 then
    raise exception 'Expected between one and five matches'
      using errcode = '22023';
  end if;

  -- The actor must still be an active requester.
  perform u.user_id
  from public.app_user u
  join public.department d
    on d.department_id = u.department_id
  where u.user_id = p_actor_id
    and u.account_status = 'active'
    and d.is_active = true
    and exists (
      select 1
      from public.user_role ur
      join public.role r on r.role_id = ur.role_id
      where ur.user_id = u.user_id
        and r.role_name = 'requester'
    )
  for share of u, d;

  if not found then
    raise exception 'Active requester profile required'
      using errcode = '42501';
  end if;

  -- Serialize ranking saves with changes to this request.
  select rr.*
    into v_request
  from public.resource_request rr
  where rr.request_id = p_request_id
    and rr.submitted_by = p_actor_id
  for update;

  if not found then
    raise exception 'Request unavailable'
      using errcode = '42501';
  end if;

  if v_request.request_status not in ('Submitted', 'Under Review') then
    raise exception 'Request is no longer open for matching'
      using errcode = '22023';
  end if;

  if v_request.specifications is distinct from p_specifications_snapshot then
    raise exception 'Request changed; generate matches again'
      using errcode = '22023';
  end if;

  -- Retrying a successfully saved run does not insert duplicates
  -- or overwrite any human review decisions.
  if exists (
    select 1
    from public.match_recommendation m
    where m.request_id = p_request_id
      and m.ranking_run_id = p_ranking_run_id
  ) then
    return p_ranking_run_id;
  end if;

  -- Validate each result before writing anything.
  for v_item in
    select value from jsonb_array_elements(p_matches)
  loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or jsonb_typeof(v_item -> 'asset_id') is distinct from 'string'
      or jsonb_typeof(v_item -> 'compatibility_score') is distinct from 'number'
      or jsonb_typeof(v_item -> 'explanation') is distinct from 'string'
    then
      raise exception 'Invalid recommendation shape'
        using errcode = '22023';
    end if;

    v_asset_id := (v_item ->> 'asset_id')::uuid;
    v_score := (v_item ->> 'compatibility_score')::numeric;
    v_reason := btrim(v_item ->> 'explanation');

    if v_score < 0 or v_score > 100 or v_score <> trunc(v_score) then
      raise exception 'Invalid recommendation score'
        using errcode = '22023';
    end if;

    if char_length(v_reason) not between 1 and 240 then
      raise exception 'Invalid recommendation explanation'
        using errcode = '22023';
    end if;
  end loop;

  if (
    select count(distinct (entry ->> 'asset_id')::uuid)
    from jsonb_array_elements(p_matches) as items(entry)
  ) <> v_count then
    raise exception 'Duplicate assets are not allowed'
      using errcode = '22023';
  end if;

  -- Lock in UUID order to reduce conflicting lock-order problems.
  -- Eligibility is rechecked after the AI call.
  for v_asset_id in
    select (entry ->> 'asset_id')::uuid
    from jsonb_array_elements(p_matches) as items(entry)
    order by (entry ->> 'asset_id')::uuid
  loop
    perform a.asset_id
    from public.asset a
    join public.department d
      on d.department_id = a.owning_department_id
    where a.asset_id = v_asset_id
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
      raise exception 'Candidate availability changed; refresh matches'
        using errcode = '22023';
    end if;
  end loop;

  select mv.model_version_id
    into v_model_id
  from public.model_version mv
  where mv.provider = 'Google'
    and mv.model_name = p_model_name
    and mv.version_label = p_model_version
    and mv.ai_function = 'matching'
  order by mv.model_version_id
  limit 1;

  if v_model_id is null then
    insert into public.model_version (
      provider,
      model_name,
      version_label,
      ai_function
    )
    values (
      'Google',
      p_model_name,
      p_model_version,
      'matching'
    )
    returning model_version_id into v_model_id;
  end if;

  for v_item in
    select value from jsonb_array_elements(p_matches)
  loop
    v_position := v_position + 1;

    insert into public.match_recommendation (
      request_id,
      asset_id,
      model_version_id,
      ranking_run_id,
      rank_position,
      compatibility_score,
      confidence,
      explanation,
      review_status
    )
    values (
      p_request_id,
      (v_item ->> 'asset_id')::uuid,
      v_model_id,
      p_ranking_run_id,
      v_position,
      (v_item ->> 'compatibility_score')::numeric,
      null,
      btrim(v_item ->> 'explanation'),
      'pending'
    );
  end loop;

  insert into public.audit_log (
    actor_id,
    action,
    record_type,
    record_id,
    new_value,
    model_version_id
  )
  values (
    p_actor_id,
    'matches_generated',
    'resource_request',
    p_request_id,
    jsonb_build_object(
      'ranking_run_id', p_ranking_run_id,
      'match_count', v_count
    ),
    v_model_id
  );

  return p_ranking_run_id;
end;
$$;

revoke all on function public.shaikha_save_matches(
  uuid, uuid, uuid, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.shaikha_save_matches(
  uuid, uuid, uuid, text, text, text, jsonb
) to service_role;

commit;