-- Run as database owner in a DISPOSABLE Supabase test project, AFTER all dependencies.
-- The entire file is one transaction and ends with ROLLBACK. No real/demo holds are changed.
-- On any error, issue ROLLBACK before retrying. These are sequential integration tests;
-- a real two-connection concurrency test is still required before acceptance.
begin;
insert into auth.users(id,email) values
 ('10000000-0000-4000-a000-000000000001','transfer-approver@test.invalid'),
 ('10000000-0000-4000-a000-000000000002','transfer-receiver@test.invalid'),
 ('10000000-0000-4000-a000-000000000003','transfer-sender@test.invalid'),
 ('10000000-0000-4000-a000-000000000004','transfer-custodian@test.invalid');
insert into public.department(department_id,code,name) values
 ('10000000-0000-4000-b000-000000000001','TEST-SEND','Transfer fixture source'),
 ('10000000-0000-4000-b000-000000000002','TEST-RECEIVE','Transfer fixture destination');
insert into public.app_user(user_id,full_name,email,department_id)
 select id::uuid,label,email,dept::uuid from (values
 ('10000000-0000-4000-a000-000000000001','Fixture approver','transfer-approver@test.invalid','10000000-0000-4000-b000-000000000001'),
 ('10000000-0000-4000-a000-000000000002','Fixture receiver','transfer-receiver@test.invalid','10000000-0000-4000-b000-000000000002'),
 ('10000000-0000-4000-a000-000000000003','Fixture sender','transfer-sender@test.invalid','10000000-0000-4000-b000-000000000001'),
 ('10000000-0000-4000-a000-000000000004','Fixture custodian','transfer-custodian@test.invalid','10000000-0000-4000-b000-000000000002')
 ) f(id,label,email,dept);
insert into public.user_role(user_id,role_id,assigned_by)
 select id::uuid,r.role_id,'10000000-0000-4000-a000-000000000001'::uuid
 from (values
 ('10000000-0000-4000-a000-000000000001','approver'),
 ('10000000-0000-4000-a000-000000000002','requester'),
 ('10000000-0000-4000-a000-000000000003','custodian'),
 ('10000000-0000-4000-a000-000000000004','custodian')) f(id,role_name)
 join public.role r on r.role_name=f.role_name;
insert into public.asset_category(category_id,name) values ('10000000-0000-4000-c000-000000000001','Transfer fixture equipment');
insert into public.asset(asset_id,name,description,category_id,quantity,available_quantity,owning_department_id,custodian_id,location,condition,asset_state,is_published)
 values ('10000000-0000-4000-d000-000000000001','Fixture monitors','Two fictional monitors','10000000-0000-4000-c000-000000000001',2,2,
 '10000000-0000-4000-b000-000000000001','10000000-0000-4000-a000-000000000003','Source room','Good','Available',true),
 ('10000000-0000-4000-d000-000000000002','Fixture printer','Unrelated item in the same category','10000000-0000-4000-c000-000000000001',1,1,
 '10000000-0000-4000-b000-000000000001','10000000-0000-4000-a000-000000000003','Source room','Good','Available',true);
insert into public.resource_request(request_id,requesting_department_id,submitted_by,requested_category_id,specifications,quantity,purpose,urgency,request_status)
 select id::uuid,'10000000-0000-4000-b000-000000000002','10000000-0000-4000-a000-000000000002',
 '10000000-0000-4000-c000-000000000001','One monitor',1,'Fixture test','Normal','Submitted'
 from (values ('10000000-0000-4000-e000-000000000001'),('10000000-0000-4000-e000-000000000002')) f(id);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-a000-000000000002',true);
select public.renad_confirm_item_type('10000000-0000-4000-e000-000000000001','monitor');
select public.renad_confirm_item_type('10000000-0000-4000-e000-000000000002','monitor');
do $$ begin
 begin
  perform public.renad_verify_asset('10000000-0000-4000-e000-000000000001','10000000-0000-4000-d000-000000000001',
   '{"item_type":"monitor"}','clear',false,null,null,null,current_date,'Untrusted claimant',true);
  raise exception 'TEST FAILED: requester certified asset';
 exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-a000-000000000003',true);
select public.renad_verify_asset('10000000-0000-4000-e000-000000000001','10000000-0000-4000-d000-000000000001',
 '{"item_type":"monitor"}','clear',false,null,null,null,current_date+1,'Fixture source',true);
select public.renad_verify_asset('10000000-0000-4000-e000-000000000002','10000000-0000-4000-d000-000000000001',
 '{"item_type":"monitor"}','clear',false,null,null,null,current_date+1,'Fixture source',true);
select public.renad_verify_asset('10000000-0000-4000-e000-000000000001','10000000-0000-4000-d000-000000000002',
 '{"item_type":"printer"}','clear',false,null,null,null,current_date+1,'Fixture source',true);
select set_config('request.jwt.claim.sub','10000000-0000-4000-a000-000000000001',true);
select public.renad_start_review('10000000-0000-4000-e000-000000000001');
select public.renad_start_review('10000000-0000-4000-e000-000000000002');
do $$ declare workspace jsonb; begin
 workspace:=public.renad_approval_workspace();
 if exists(select 1 from jsonb_array_elements(workspace->'requests') r, jsonb_array_elements(r->'assets') a
  where r->>'request_id'='10000000-0000-4000-e000-000000000001' and a->>'asset_id'='10000000-0000-4000-d000-000000000002') then
  raise exception 'TEST FAILED: unrelated printer offered'; end if;
 begin
  perform public.renad_approve_and_reserve('10000000-0000-4000-e000-000000000001','10000000-0000-4000-d000-000000000002','Invalid printer',now()+interval '1 day');
  raise exception 'TEST FAILED: direct RPC allocated unrelated printer';
 exception when invalid_parameter_value then null; end;
end; $$;
select public.renad_approve_and_reserve('10000000-0000-4000-e000-000000000001','10000000-0000-4000-d000-000000000001','Valid monitor',now()+interval '1 day');
select public.renad_approve_and_reserve('10000000-0000-4000-e000-000000000002','10000000-0000-4000-d000-000000000001','Second monitor',now()+interval '1 day');
reset role;
-- Save fixture IDs in transaction settings so authenticated tests need no broad table reads.
select set_config('test.hold1',(select reservation_id::text from public.reservation where request_id='10000000-0000-4000-e000-000000000001'),true);
select set_config('test.hold2',(select reservation_id::text from public.reservation where request_id='10000000-0000-4000-e000-000000000002'),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-a000-000000000002',true);
do $$ begin
 begin
  perform public.renad_create_transfer(current_setting('test.hold1')::uuid);
  raise exception 'TEST FAILED: requester arranged sender handover';
 exception when insufficient_privilege then null; end;
end; $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-a000-000000000003',true);
select set_config('test.transfer1',public.renad_create_transfer(current_setting('test.hold1')::uuid)::text,true);
select set_config('test.transfer2',public.renad_create_transfer(current_setting('test.hold2')::uuid)::text,true);
do $$ begin
 if public.renad_create_transfer(current_setting('test.hold1')::uuid)::text<>current_setting('test.transfer1') then
  raise exception 'TEST FAILED: duplicate transfer on retry'; end if;
 begin
  perform public.renad_release_transfer(current_setting('test.transfer1')::uuid);
  raise exception 'TEST FAILED: unscheduled transfer released';
 exception when invalid_parameter_value then null; end;
end; $$;
select public.renad_schedule_transfer(current_setting('test.transfer1')::uuid,current_date,'Destination room',
 '10000000-0000-4000-a000-000000000002','10000000-0000-4000-a000-000000000004','Fixture collection',0,'TEST');