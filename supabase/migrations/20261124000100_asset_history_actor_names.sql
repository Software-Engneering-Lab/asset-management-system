begin;

-- Return actor names only within an authorized asset's history.
-- This does not grant access to other users' full profiles.
create or replace function public.renad_asset_history_with_names(
  p_asset_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if public.renad_active_user() is not true then
    raise exception 'An active account and department are required.'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.asset a
    where a.asset_id = p_asset_id
      and (
        public.has_role('admin')
        or public.has_role('approver')
        or (
          public.has_role('custodian')
          and (
            a.owning_department_id = public.current_department_id()
            or a.custodian_id = auth.uid()
          )
        )
      )
  ) then
    raise exception 'You cannot view this asset history.'
      using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'event_id', h.event_id,
        'event_type', h.event_type,
        'previous_state', h.previous_state,
        'new_state', h.new_state,
        'details', h.details,
        'event_at', h.event_at,
        'performed_by', h.performed_by,
        'app_user', jsonb_build_object('full_name', u.full_name)
      )
      order by h.event_at desc, h.event_id desc
    ),
    '[]'::jsonb
  )
  into result
  from public.asset_history_event h
  left join public.app_user u on u.user_id = h.performed_by
  where h.asset_id = p_asset_id;

  return result;
end;
$$;

revoke all on function
  public.renad_asset_history_with_names(uuid)
  from public, anon, authenticated;

grant execute on function
  public.renad_asset_history_with_names(uuid)
  to authenticated;

commit;