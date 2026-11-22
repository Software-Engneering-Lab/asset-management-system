-- C4: authorized request submission.
-- Depends on the two existing foundation migrations.
-- Review with Budoor and Renad before applying.
-- Does not assign roles, provision profiles or disable RLS.

begin;

create function public.shaikha_submit_request(
  p_category_name text,
  p_specifications text,
  p_quantity integer,
  p_preferred_condition text,
  p_purpose text,
  p_urgency text,
  p_preferred_location text,
  p_required_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_department_id uuid;
  v_category_id uuid;
  v_request_id uuid;
begin
  -- Identity comes from the authenticated session.
  if v_user_id is null then
    raise exception 'Sign-in required'
      using errcode = '42501';
  end if;

  -- Require an active profile in an active department.
  select u.department_id
    into v_department_id
  from public.app_user u
  join public.department d
    on d.department_id = u.department_id
  where u.user_id = v_user_id
    and u.account_status = 'active'
    and d.is_active = true
  for share of u, d;

  if v_department_id is null then
    raise exception 'Active user profile and department required'
      using errcode = '42501';
  end if;

  -- Being signed in alone does not give requester permissions.
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

  -- Validate again inside the database.
  if p_specifications is null
    or char_length(btrim(p_specifications)) not between 1 and 5000
  then
    raise exception 'Invalid specifications'
      using errcode = '22023';
  end if;

  if p_purpose is null
    or char_length(btrim(p_purpose)) not between 1 and 5000
  then
    raise exception 'Invalid purpose'
      using errcode = '22023';
  end if;

  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantity must be positive'
      using errcode = '22023';
  end if;

  if p_urgency is null
    or p_urgency not in ('Low', 'Normal', 'High')
  then
    raise exception 'Invalid urgency'
      using errcode = '22023';
  end if;

  if nullif(btrim(p_preferred_condition), '') is not null
    and btrim(p_preferred_condition) not in ('Good', 'Fair', 'Poor')
  then
    raise exception 'Invalid preferred condition'
      using errcode = '22023';
  end if;

  if char_length(btrim(p_preferred_location)) > 150 then
    raise exception 'Location is too long'
      using errcode = '22023';
  end if;

  select c.category_id
    into v_category_id
  from public.asset_category c
  where c.name = btrim(p_category_name);

  if v_category_id is null then
    raise exception 'Category does not exist'
      using errcode = '22023';
  end if;

  insert into public.resource_request (
    requesting_department_id,
    submitted_by,
    requested_category_id,
    specifications,
    quantity,
    preferred_condition,
    purpose,
    urgency,
    preferred_location,
    required_date,
    request_status,
    submitted_at
  )
  values (
    v_department_id,
    v_user_id,
    v_category_id,
    btrim(p_specifications),
    p_quantity,
    nullif(btrim(p_preferred_condition), ''),
    btrim(p_purpose),
    p_urgency,
    nullif(btrim(p_preferred_location), ''),
    p_required_date,
    'Submitted',
    now()
  )
  returning request_id into v_request_id;

  -- Trusted history: the form cannot choose the actor or status.
  insert into public.request_status_history (
    request_id,
    from_status,
    to_status,
    changed_by,
    reason
  )
  values (
    v_request_id,
    null,
    'Submitted',
    v_user_id,
    'Requester submitted a resource request'
  );

  insert into public.audit_log (
    actor_id,
    action,
    record_type,
    record_id,
    new_value
  )
  values (
    v_user_id,
    'request_submitted',
    'resource_request',
    v_request_id,
    jsonb_build_object(
      'request_status', 'Submitted',
      'quantity', p_quantity,
      'requested_category_id', v_category_id
    )
  );

  -- All three inserts succeed together or roll back together.
  return v_request_id;
end;
$$;

-- No anonymous execution and no general table-write grants.
revoke all on function public.shaikha_submit_request(
  text, text, integer, text, text, text, text, date
) from public, anon, authenticated;

grant execute on function public.shaikha_submit_request(
  text, text, integer, text, text, text, text, date
) to authenticated;

commit;