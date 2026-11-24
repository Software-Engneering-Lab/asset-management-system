-- AI 1 - Classification and tagging (Budoor)
-- The custodian can ask AI to suggest a category, condition and tags from the
-- asset description, then accepts or edits them before saving (human in the loop).
-- Adds ONE column to the shared asset table (no duplicate tables) and ONE function
-- that saves the reviewed tags and writes an audit entry with the AI suggestion.
-- New migration on purpose: applied migrations are never edited.

alter table public.asset
  add column if not exists tags text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'asset_tags_max_8') then
    alter table public.asset add constraint asset_tags_max_8 check (cardinality(tags) <= 8);
  end if;
end $$;

-- Saves the custodian-reviewed tags for an asset of her own department.
-- p_suggestion = what AI 1 (or the rule-based fallback) suggested, kept for the audit trail.
create or replace function public.budoor_save_asset_tags(
  p_asset_id uuid, p_tags text[], p_suggestion jsonb default null)
returns text[]
language plpgsql security definer set search_path = public
as $$
declare
  v_asset public.asset;
  v_tags text[];
begin
  if not public.has_role('custodian') then
    raise exception 'Only custodians can tag assets.' using errcode = '42501';
  end if;
  select * into v_asset from public.asset where asset_id = p_asset_id for update;
  if not found then
    raise exception 'Asset not found.' using errcode = 'P0002';
  end if;
  if v_asset.owning_department_id is distinct from public.current_department_id() then
    raise exception 'You can only tag assets of your own department.' using errcode = '42501';
  end if;

  -- Clean the tags: lowercase, trimmed, 1-30 characters, no duplicates, at most 8.
  select coalesce(array_agg(t order by first_pos), '{}') into v_tags
  from (
    select t, min(pos) as first_pos
    from (
      select lower(btrim(raw)) as t, pos
      from unnest(coalesce(p_tags, '{}')) with ordinality as u(raw, pos)
    ) cleaned
    where length(t) between 1 and 30
    group by t
    order by min(pos)
    limit 8
  ) unique_tags;

  update public.asset set tags = v_tags where asset_id = p_asset_id;

  perform public.write_audit(
    'AI1_TAGS_REVIEWED', 'asset', p_asset_id,
    jsonb_build_object('tags', v_asset.tags),
    jsonb_build_object('tags', v_tags, 'ai_suggestion', p_suggestion),
    'Custodian reviewed AI 1 classification and tags');
  return v_tags;
end;
$$;

revoke all on function public.budoor_save_asset_tags(uuid, text[], jsonb) from public, anon;
grant execute on function public.budoor_save_asset_tags(uuid, text[], jsonb) to authenticated;

notify pgrst, 'reload schema';
