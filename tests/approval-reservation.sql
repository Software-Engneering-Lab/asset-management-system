-- Integration test for a DISPOSABLE Supabase/local test database.
-- Requires foundations, Budoor access, Shaikha matching, and both Renad Nov 16 migrations. Everything rolls back.
-- Execute as the project owner, not a browser user. Never paste in a seed migration.
-- These fixed UUIDs are isolated test fixtures; a collision intentionally fails.
begin;
insert into auth.users(id,email) values
 ('00000000-0000-4000-a000-000000000001','approver@test.invalid'),
 ('00000000-0000-4000-a000-000000000002','requester@test.invalid');
insert into public.department(department_id,code,name) values
 ('00000000-0000-4000-b000-000000000001','TEST-RENAD','Rollback test department');
insert into public.app_user(user_id,full_name,email,department_id) values
 ('00000000-0000-4000-a000-000000000001','Test Approver','approver@test.invalid','00000000-0000-4000-b000-000000000001'),
 ('00000000-0000-4000-a000-000000000002','Test Requester','requester@test.invalid','00000000-0000-4000-b000-000000000001');
insert into public.user_role(user_id,role_id,assigned_by)
 select '00000000-0000-4000-a000-000000000001',role_id,'00000000-0000-4000-a000-000000000001'
 from public.role where role_name='approver';
insert into public.asset_category(category_id,name) values
 ('00000000-0000-4000-c000-000000000001','Rollback test category');
insert into public.asset(asset_id,name,description,category_id,quantity,available_quantity,
 owning_department_id,location,condition,asset_state,is_published) values
 ('00000000-0000-4000-d000-000000000001','Last unit','Fictional test asset',
 '00000000-0000-4000-c000-000000000001',1,1,'00000000-0000-4000-b000-000000000001',
 'Test store','Good','Available',true);
insert into public.resource_request(request_id,requesting_department_id,submitted_by,
 requested_category_id,specifications,quantity,purpose,urgency,request_status)
 select id::uuid,'00000000-0000-4000-b000-000000000001',actor::uuid,
 '00000000-0000-4000-c000-000000000001','Test',1,'Test','Normal','Submitted'
 from (values
 ('00000000-0000-4000-e000-000000000001','00000000-0000-4000-a000-000000000002'),
 ('00000000-0000-4000-e000-000000000002','00000000-0000-4000-a000-000000000002'),
 ('00000000-0000-4000-e000-000000000003','00000000-0000-4000-a000-000000000001'),
 ('00000000-0000-4000-e000-000000000004','00000000-0000-4000-a000-000000000002')
 ) as f(id,actor);

-- The eligibility correction requires confirmed requirements and independently recorded facts.
insert into public.user_role(user_id,role_id,assigned_by)
 select u.user_id,r.role_id,'00000000-0000-4000-a000-000000000001'::uuid
 from public.app_user u cross join public.role r
 where (u.user_id='00000000-0000-4000-a000-000000000002' and r.role_name='requester')
 or (u.user_id='00000000-0000-4000-a000-000000000001' and r.role_name='custodian');
insert into public.shaikha_request_match_rules(request_id,request_snapshot,mandatory_requirements,preferred_requirements,confirmed_by)
 select request_id,public.shaikha_request_snapshot(q),
 '[{"field":"item_type","operator":"eq","value":"monitor"}]','[]',submitted_by
 from public.resource_request q where request_id in (
 '00000000-0000-4000-e000-000000000001','00000000-0000-4000-e000-000000000002',
 '00000000-0000-4000-e000-000000000003','00000000-0000-4000-e000-000000000004');
insert into public.shaikha_asset_match_evidence(request_id,asset_id,asset_snapshot,evidence,reviewed_by,source_reference,expires_at)
 select q.request_id,a.asset_id,public.shaikha_asset_snapshot(a),
 jsonb_build_object('specifications',jsonb_build_object('item_type','monitor'),'safetyStatus','clear',
 'inspectionRequired',false,'inspection',null,'earliestReceiptDate',null,
 'requestSpecifications',q.specifications,'specificationsVerified',true),
 '00000000-0000-4000-a000-000000000001','Fictional fixture facts',now()+interval '1 day'
 from public.resource_request q cross join public.asset a
 where q.request_id in ('00000000-0000-4000-e000-000000000001','00000000-0000-4000-e000-000000000002',
 '00000000-0000-4000-e000-000000000003','00000000-0000-4000-e000-000000000004')
 and a.asset_id='00000000-0000-4000-d000-000000000001';

-- Check actual client permissions, not just owner-executed function behavior.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000002',true);
do $$ begin
  begin
    perform public.renad_start_review('00000000-0000-4000-e000-000000000001');
    raise exception 'TEST FAILED: requester was allowed to review';
  exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000001',true);
do $$ begin
  begin
    perform public.renad_start_review('00000000-0000-4000-e000-000000000003');
    raise exception 'TEST FAILED: self-review was allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.renad_decide_request('00000000-0000-4000-e000-000000000001','Approved',
      '00000000-0000-4000-d000-000000000001','Premature decision');
    raise exception 'TEST FAILED: Submitted request bypassed review';
  exception when invalid_parameter_value then null; end;
end; $$;
select public.renad_start_review('00000000-0000-4000-e000-000000000001');
select public.renad_start_review('00000000-0000-4000-e000-000000000002');
select public.renad_decide_request('00000000-0000-4000-e000-000000000001','Approved',
 '00000000-0000-4000-d000-000000000001','First approval');
select public.renad_decide_request('00000000-0000-4000-e000-000000000002','Approved',
 '00000000-0000-4000-d000-000000000001','Second approval; no stock held yet');
reset role;
do $$ begin
 if (select available_quantity from public.asset where asset_id='00000000-0000-4000-d000-000000000001')<>1 then
  raise exception 'TEST FAILED: approval changed stock'; end if;
end; $$;
set local role authenticated;
select public.renad_reserve_asset('00000000-0000-4000-e000-000000000001',now()+interval '1 hour');
-- Retry returns the existing hold, without a second subtraction or history entry.
select public.renad_reserve_asset('00000000-0000-4000-e000-000000000001',now()+interval '1 hour');
do $$ begin
 begin
  perform public.renad_reserve_asset('00000000-0000-4000-e000-000000000002',now()+interval '1 hour');