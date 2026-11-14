-- Integration test for a DISPOSABLE Supabase/local test database.
-- Requires foundations + Budoor + Renad migrations. Everything rolls back.
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

-- Check actual client permissions, not just owner-executed function behavior.
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-a000-000000000002',true);
do $$ begin
  begin
    perform public.renad_start_review('00000000-0000-4000-e000-000000000001');
    raise exception 'TEST FAILED: requester was allowed to review';
  exception when insufficient_privilege then null; end;
end $$;
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
end $$;
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
end $$;
set local role authenticated;
select public.renad_reserve_asset('00000000-0000-4000-e000-000000000001',now()+interval '1 hour');
-- Retry returns the existing hold, without a second subtraction or history entry.
select public.renad_reserve_asset('00000000-0000-4000-e000-000000000001',now()+interval '1 hour');
do $$ begin
 begin
  perform public.renad_reserve_asset('00000000-0000-4000-e000-000000000002',now()+interval '1 hour');
  raise exception 'TEST FAILED: last unit was double allocated';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.renad_end_reservation('00000000-0000-4000-e000-000000000001',true,'Too early');
  raise exception 'TEST FAILED: unexpired hold was expired';
 exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
 if (select available_quantity from public.asset where asset_id='00000000-0000-4000-d000-000000000001')<>0 then
  raise exception 'TEST FAILED: wrong stock after reservation'; end if;
 if (select count(*) from public.request_status_history where request_id='00000000-0000-4000-e000-000000000001' and to_status='Reserved')<>1 then
  raise exception 'TEST FAILED: duplicate reservation history'; end if;
 if (select request_status from public.resource_request where request_id='00000000-0000-4000-e000-000000000002')<>'Approved' then
  raise exception 'TEST FAILED: failed allocation changed request'; end if;
end $$;
set local role authenticated;
select public.renad_end_reservation('00000000-0000-4000-e000-000000000001',false,'Cancel test');
select public.renad_reserve_asset('00000000-0000-4000-e000-000000000002',now()+interval '1 hour');
reset role;
-- Advance only the fixture hold's dates to simulate expiry.
update public.reservation set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'
 where request_id='00000000-0000-4000-e000-000000000002';
set local role authenticated;
select public.renad_end_reservation('00000000-0000-4000-e000-000000000002',true,'Expiry test');
reset role;
do $$ begin
 if (select available_quantity from public.asset where asset_id='00000000-0000-4000-d000-000000000001')<>1 then
  raise exception 'TEST FAILED: expiry did not restore stock'; end if;
 if (select request_status from public.resource_request where request_id='00000000-0000-4000-e000-000000000002')<>'Approved' then
  raise exception 'TEST FAILED: expiry did not restore Approved state'; end if;
 if has_function_privilege('anon','public.renad_reserve_asset(uuid,timestamp with time zone)','EXECUTE') then
  raise exception 'TEST FAILED: anonymous allocation is allowed'; end if;
 if has_function_privilege('authenticated','public.renad_set_request_status(uuid,text,text)','EXECUTE') then
  raise exception 'TEST FAILED: client can bypass the workflow helper'; end if;
 if has_table_privilege('authenticated','public.reservation','INSERT') then
  raise exception 'TEST FAILED: client can create holds directly'; end if;
end $$;
-- An invalid expiry must roll back the preceding approval inside the combined operation.
set local role authenticated;
select public.renad_start_review('00000000-0000-4000-e000-000000000004');
do $$ begin
 begin
  perform public.renad_approve_and_reserve('00000000-0000-4000-e000-000000000004',
   '00000000-0000-4000-d000-000000000001','Atomic rollback test',now()-interval '1 hour');
  raise exception 'TEST FAILED: invalid expiry accepted';
 exception when invalid_parameter_value then null; end;
end $$;
reset role;
do $$ begin
 if (select request_status from public.resource_request where request_id='00000000-0000-4000-e000-000000000004')<>'Under Review'
 or exists(select 1 from public.approval where request_id='00000000-0000-4000-e000-000000000004') then
  raise exception 'TEST FAILED: failed combined operation left an approval'; end if;
end $$;
-- Holding part of a batch must leave the remainder published and Available.
update public.asset set quantity=3,available_quantity=3
 where asset_id='00000000-0000-4000-d000-000000000001';
set local role authenticated;
select public.renad_approve_and_reserve('00000000-0000-4000-e000-000000000004',
 '00000000-0000-4000-d000-000000000001','Batch remainder test',now()+interval '1 hour');
reset role;
do $$ begin
 if not exists(select 1 from public.asset where asset_id='00000000-0000-4000-d000-000000000001'
  and available_quantity=2 and asset_state='Available' and is_published) then
  raise exception 'TEST FAILED: partial batch remainder became unavailable'; end if;
end $$;
select 'All approval/reservation assertions passed; rolling back fixtures.' as result;
rollback;
