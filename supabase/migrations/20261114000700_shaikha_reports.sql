-- AI5: operational report calculations, drafts and human publication.
-- Requires existing foundation tables.
-- Review and apply once through the team's migration process.

begin;

alter table public.report_summary
  add column generated_by uuid references public.app_user(user_id),
  add column generation_method text
    check (generation_method in ('ai', 'manual')),
  add column revision integer not null default 0;

-- Internal authorization helper. Not exposed for client execution.
create function public.shaikha_report_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.app_user u
    join public.department d
      on d.department_id = u.department_id
    join public.user_role ur
      on ur.user_id = u.user_id
    join public.role r
      on r.role_id = ur.role_id
    where u.user_id = p_user_id
      and u.account_status = 'active'
      and d.is_active = true
      and r.role_name = 'admin'
  );
$$;

revoke all on function public.shaikha_report_admin(uuid)
  from public, anon, authenticated;

-- Calculate authoritative figures from stored records.
-- Reporting dates are inclusive and interpreted in UTC.
create function public.shaikha_report_snapshot(
  p_period_start date,
  p_period_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_requests bigint;
  v_transfers bigint;
  v_units bigint;
  v_missing_quantities bigint;
begin
  if auth.uid() is null
    or not public.shaikha_report_admin(auth.uid())
  then
    raise exception 'Admin access required'
      using errcode = '42501';
  end if;

  if p_period_start is null
    or p_period_end is null
    or p_period_end < p_period_start
    or p_period_end - p_period_start > 365
  then
    raise exception 'Choose a reporting period of at most 366 days'
      using errcode = '22023';
  end if;

  v_start := p_period_start::timestamp at time zone 'UTC';
  v_end := (p_period_end + 1)::timestamp at time zone 'UTC';

  select count(*)
    into v_requests
  from public.resource_request rr
  where rr.submitted_at >= v_start
    and rr.submitted_at < v_end;

  select
    count(*),
    coalesce(sum(t.received_quantity::bigint), 0),
    count(*) filter (where t.received_quantity is null)
  into v_transfers, v_units, v_missing_quantities
  from public.transfer t
  where t.transfer_status = 'Completed'
    and t.received_at >= v_start
    and t.received_at < v_end;

  return jsonb_build_object(
    'period_start', p_period_start,
    'period_end', p_period_end,
    'timezone', 'UTC',
    'snapshot_at', now(),
    'figures', jsonb_build_object(
      'submitted_requests', v_requests,
      'completed_transfers', v_transfers,
      'received_units_known', v_units,
      'transfers_missing_received_quantity', v_missing_quantities
    )
  );
end;
$$;

-- Load the latest reports for authorized admins.
create function public.shaikha_report_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_reports jsonb;
begin
  if auth.uid() is null
    or not public.shaikha_report_admin(auth.uid())
  then
    raise exception 'Admin access required'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'summary_id', q.summary_id,
        'report_type', q.report_type,
        'period_start', q.period_start,
        'period_end', q.period_end,
        'draft_text', q.draft_text,
        'published_text', q.published_text,
        'review_status', q.review_status,
        'generation_method', q.generation_method,
        'calculated_figures', q.calculated_figures,
        'created_at', q.created_at,
        'published_at', q.published_at,
        'revision', q.revision
      )
      order by q.created_at desc, q.summary_id
    ),
    '[]'::jsonb
  )
  into v_reports
  from (
    select *
    from public.report_summary
    order by created_at desc, summary_id
    limit 50
  ) q;

  return jsonb_build_object('reports', v_reports);
end;
$$;

-- Save a server-generated draft.
-- Browser clients cannot call this privileged operation.
create function public.shaikha_save_report(
  p_actor_id uuid,
  p_period_start date,
  p_period_end date,
  p_snapshot jsonb,
  p_draft_text text,
  p_generation_method text,
  p_model_name text,
  p_model_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_model_id uuid;
  v_summary_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Server operation required'
      using errcode = '42501';
  end if;

  if p_actor_id is null
    or not public.shaikha_report_admin(p_actor_id)
  then
    raise exception 'Active admin required'
      using errcode = '42501';
  end if;

  if p_period_start is null
    or p_period_end is null
    or p_period_end < p_period_start
    or p_period_end - p_period_start > 365
  then
    raise exception 'Invalid reporting period'
      using errcode = '22023';
  end if;

  if jsonb_typeof(p_snapshot) is distinct from 'object'
    or jsonb_typeof(p_snapshot -> 'figures') is distinct from 'object'
    or (p_snapshot ->> 'period_start')
      is distinct from p_period_start::text
    or (p_snapshot ->> 'period_end')
      is distinct from p_period_end::text
  then
    raise exception 'Invalid report snapshot'
      using errcode = '22023';
  end if;

  if p_draft_text is null
    or char_length(btrim(p_draft_text)) not between 1 and 8000
  then
    raise exception 'Invalid draft text'
      using errcode = '22023';
  end if;

  if p_generation_method is null
    or p_generation_method not in ('ai', 'manual')
  then
    raise exception 'Invalid generation method'
      using errcode = '22023';
  end if;

  if p_generation_method = 'ai' then
    if nullif(btrim(p_model_name), '') is null
      or char_length(p_model_name) > 80
      or nullif(btrim(p_model_version), '') is null
      or char_length(p_model_version) > 80
    then
      raise exception 'AI model metadata required'
        using errcode = '22023';
    end if;

    select mv.model_version_id
      into v_model_id
    from public.model_version mv
    where mv.provider = 'Google'
      and mv.model_name = p_model_name
      and mv.version_label = p_model_version
      and mv.ai_function = 'report_summary'
    order by mv.model_version_id
    limit 1;

    if v_model_id is null then
      insert into public.model_version (
        provider, model_name, version_label, ai_function
      )
      values (
        'Google', p_model_name, p_model_version, 'report_summary'
      )
      returning model_version_id into v_model_id;
    end if;
  else
    -- Manual fallback must not pretend an AI model generated it.
    if p_model_name is not null or p_model_version is not null then
      raise exception 'Manual drafts must not claim an AI model'
        using errcode = '22023';
    end if;
  end if;

  insert into public.report_summary (
    report_type,
    period_start,
    period_end,
    draft_text,
    model_version_id,
    calculated_figures,
    generated_by,
    generation_method,
    review_status
  )
  values (
    'Operational',
    p_period_start,
    p_period_end,
    btrim(p_draft_text),
    v_model_id,
    p_snapshot,
    p_actor_id,
    p_generation_method,
    'draft'
  )
  returning summary_id into v_summary_id;

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
    'report_generated',
    'report_summary',
    v_summary_id,
    jsonb_build_object(
      'generation_method', p_generation_method,
      'review_status', 'draft'
    ),
    v_model_id
  );

  return v_summary_id;
end;
$$;

-- Human review preserves the original draft and figures.
-- The revision prevents one admin overwriting another admin's edits.
create function public.shaikha_review_report(
  p_summary_id uuid,
  p_text text,
  p_publish boolean,
  p_expected_revision integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_report public.report_summary%rowtype;
  v_status text;
begin
  if v_actor is null
    or not public.shaikha_report_admin(v_actor)
  then
    raise exception 'Admin access required'
      using errcode = '42501';
  end if;

  if p_text is null
    or char_length(btrim(p_text)) not between 1 and 8000
    or p_publish is null
    or p_expected_revision is null
  then
    raise exception 'Invalid review details'
      using errcode = '22023';
  end if;

  select rs.*
    into v_report
  from public.report_summary rs
  where rs.summary_id = p_summary_id
  for update;

  if not found then
    raise exception 'Report unavailable'
      using errcode = '22023';
  end if;

  if v_report.review_status = 'published' then
    raise exception 'Published reports cannot be overwritten'
      using errcode = '22023';
  end if;

  if v_report.revision <> p_expected_revision then
    raise exception 'Report changed; refresh before reviewing'
      using errcode = '22023';
  end if;

  v_status := case when p_publish then 'published' else 'reviewed' end;

  update public.report_summary
  set
    published_text = btrim(p_text),
    review_status = v_status,
    reviewed_by = v_actor,
    reviewed_at = now(),
    published_at = case when p_publish then now() else null end,
    revision = revision + 1
  where summary_id = p_summary_id;

  insert into public.audit_log (
    actor_id,
    action,
    record_type,
    record_id,
    previous_value,
    new_value,
    model_version_id
  )
  values (
    v_actor,
    case when p_publish then 'report_published' else 'report_reviewed' end,
    'report_summary',
    p_summary_id,
    jsonb_build_object(
      'review_status', v_report.review_status,
      'published_text', v_report.published_text,
      'revision', v_report.revision
    ),
    jsonb_build_object(
      'review_status', v_status,
      'published_text', btrim(p_text),
      'revision', v_report.revision + 1
    ),
    v_report.model_version_id
  );

  return p_summary_id;
end;
$$;

revoke all on function public.shaikha_report_snapshot(date, date)
  from public, anon, authenticated;
grant execute on function public.shaikha_report_snapshot(date, date)
  to authenticated;

revoke all on function public.shaikha_report_workspace()
  from public, anon, authenticated;
grant execute on function public.shaikha_report_workspace()
  to authenticated;

revoke all on function public.shaikha_save_report(
  uuid, date, date, jsonb, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.shaikha_save_report(
  uuid, date, date, jsonb, text, text, text, text
) to service_role;

revoke all on function public.shaikha_review_report(
  uuid, text, boolean, integer
) from public, anon, authenticated;
grant execute on function public.shaikha_review_report(
  uuid, text, boolean, integer
) to authenticated;

commit;