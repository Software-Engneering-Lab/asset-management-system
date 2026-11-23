-- =====================================================================
-- 20261123120000_ensure_list_custodians.sql
-- SAFE TO RUN EVEN IF ALREADY APPLIED (create or replace; nothing else changes).
--
-- Fixes "PGRST202: Could not find the function public.list_custodians" on /assets/new.
-- Same definition as section 2 of 20261114130000_budoor_access_fixes.sql, copied
-- unchanged, so you do NOT need to rerun that whole file (rerunning it would bring
-- back the old register/publish rules).
-- The last line tells Supabase's API (PostgREST) to reload its list of functions.
-- =====================================================================
begin;

create or replace function public.list_custodians()
returns table (user_id uuid, full_name text, department_id uuid)
language plpgsql stable security definer set search_path = public
as $$
begin
  if (public.has_role('admin') or public.has_role('custodian')) is not true then
    raise exception 'Only a custodian or administrator can list custodians.';
  end if;
  return query
    select u.user_id, u.full_name::text, u.department_id
    from public.app_user u
    join public.user_role ur on ur.user_id = u.user_id
    join public.role r       on r.role_id = ur.role_id and r.role_name = 'custodian'
    where u.account_status = 'active'
      and (public.has_role('admin') or u.department_id = public.current_department_id())
    order by u.full_name;
end;
$$;

revoke execute on function public.list_custodians() from public, anon;
grant  execute on function public.list_custodians() to authenticated;

commit;

notify pgrst, 'reload schema';
