-- Run after both migrations in Supabase SQL Editor.
-- Read-only checks. Expected counts: 17 tables, 17 RLS enabled, 0 client table grants.
select count(*) as foundation_tables, count(*) filter(where rowsecurity) as rls_enabled
from pg_tables where schemaname='public' and tablename in
('department','app_user','role','user_role','asset_category','asset','resource_request',
 'approval','reservation','transfer','transfer_discrepancy','asset_history_event',
 'request_status_history','model_version','match_recommendation','report_summary','audit_log');

select table_name,grantee,privilege_type
from information_schema.role_table_grants
where table_schema='public' and grantee in ('anon','authenticated')
and table_name in
('department','app_user','role','user_role','asset_category','asset','resource_request',
 'approval','reservation','transfer','transfer_discrepancy','asset_history_event',
 'request_status_history','model_version','match_recommendation','report_summary','audit_log');

select role_name from public.role order by role_name;
select code,name from public.department order by code;
select name from public.asset_category order by name;

