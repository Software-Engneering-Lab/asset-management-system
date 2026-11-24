-- ISOLATED/DISPOSABLE SUPABASE TEST DATABASE ONLY. NOT a migration.
-- Requires existing foundation, foundation contract and the NEW C8 migration.
-- Do not run on the shared/production project or use this to create demo outcomes.
-- In the SAME isolated database connection, explicitly opt in first:
-- SET shaikha.c8_allow_isolated_test = 'yes';
-- Run with stop-on-error. If it errors, ROLLBACK before doing anything else.
begin;
do $$ begin
 if current_setting('shaikha.c8_allow_isolated_test',true) is distinct from 'yes' then
  raise exception 'STOP: isolated database opt-in required; never run against shared/production data';
 end if;
end $$;

do $$
declare
 v_owner uuid := gen_random_uuid(); v_other uuid := gen_random_uuid();
 v_to uuid := gen_random_uuid(); v_from uuid := gen_random_uuid();
 v_category uuid := gen_random_uuid(); v_asset uuid := gen_random_uuid();
 v_q1 uuid := gen_random_uuid(); v_q2 uuid := gen_random_uuid();
 v_a1 uuid := gen_random_uuid(); v_a2 uuid := gen_random_uuid();
 v_res uuid := gen_random_uuid(); v_transfer uuid := gen_random_uuid();
 v_new uuid; v_notice uuid; v_count integer;
begin
 perform set_config('shaikha.c8_owner',v_owner::text,true);
 perform set_config('shaikha.c8_other',v_other::text,true);
 perform set_config('shaikha.c8_request',v_q1::text,true);
 perform set_config('shaikha.c8_request2',v_q2::text,true);
 perform set_config('shaikha.c8_approval',v_a1::text,true);
 perform set_config('shaikha.c8_transfer',v_transfer::text,true);
 perform set_config('shaikha.c8_to_department',v_to::text,true);
 perform set_config('shaikha.c8_category',v_category::text,true);
 perform set_config('shaikha.c8_rollback_request',gen_random_uuid()::text,true);
 insert into auth.users(id,email,role,aud,created_at,updated_at) values
  (v_owner,'c8-owner-'||v_owner::text||'@example.invalid','authenticated','authenticated',now(),now()),
  (v_other,'c8-other-'||v_other::text||'@example.invalid','authenticated','authenticated',now(),now());
 insert into public.department(department_id,code,name) values
  (v_to,'C8T-'||left(v_to::text,8),'C8 isolated receiving fixture'),
  (v_from,'C8F-'||left(v_from::text,8),'C8 isolated sending fixture');
 insert into public.app_user(user_id,full_name,email,department_id) values
  (v_owner,'C8 isolated owner','c8-owner-'||v_owner::text||'@example.invalid',v_to),
  (v_other,'C8 isolated admin','c8-other-'||v_other::text||'@example.invalid',v_from);
 insert into public.user_role(user_id,role_id,assigned_by)
 select v_owner,role_id,v_other from public.role where role_name='requester';
 insert into public.user_role(user_id,role_id,assigned_by)
 select v_other,role_id,v_other from public.role where role_name in ('requester','approver','admin');
 insert into public.asset_category(category_id,name) values(v_category,'C8 isolated '||v_category::text);
 insert into public.asset(asset_id,name,description,category_id,quantity,available_quantity,
  owning_department_id,custodian_id,location,condition,asset_state)
 values(v_asset,'C8 isolated laptop','Fictional fixture; rolled back',v_category,3,3,
  v_from,v_other,'Isolated database only','Good','Available');
 insert into public.resource_request(request_id,requesting_department_id,submitted_by,
  requested_category_id,specifications,quantity,purpose,urgency,request_status,submitted_at)
 values(v_q1,v_to,v_owner,v_category,'Fictional fixture',1,'Isolated C8 approval test','Normal','Submitted',now()),
       (v_q2,v_to,v_owner,v_category,'Fictional fixture',1,'Isolated C8 rejection test','Normal','Submitted',now());
 if (select count(*) from public.shaikha_notification where recipient_id=v_owner)<>2 then
  raise exception 'FAIL: submission trigger did not create exactly two owner notices';
 end if;
 if public.shaikha_emit_notification('submitted',v_q1)<>0 then
  raise exception 'FAIL: repeated submission was not deduplicated';
 end if;
 insert into public.approval(approval_id,approval_type,approver_id,request_id,asset_id,decision,approved_quantity,reason)
 values(v_a1,'Request',v_other,v_q1,v_asset,'Approved',1,'Isolated C8 fixture'),
       (v_a2,'Request',v_other,v_q2,null,'Rejected',null,'Isolated C8 fixture');
 -- Validate that a premature event does not silently insert a notice.
 begin
  perform public.shaikha_emit_notification('approved',v_a1);
  raise exception 'FAIL: premature approval notification accepted';
 exception when invalid_parameter_value then null;
 end;
 update public.resource_request set request_status='Approved' where request_id=v_q1;
 update public.resource_request set request_status='Rejected' where request_id=v_q2;
 if public.shaikha_emit_notification('approved',v_a1)<>1 then raise exception 'FAIL: approval emission'; end if;
 if public.shaikha_emit_notification('approved',v_a1)<>0 then raise exception 'FAIL: approval deduplication'; end if;
 if public.shaikha_emit_notification('rejected',v_a2)<>1 then raise exception 'FAIL: rejection emission'; end if;
 insert into public.reservation(reservation_id,request_id,asset_id,approval_id,reserved_by,
  reserved_quantity,expires_at,reservation_status)
 values(v_res,v_q1,v_asset,v_a1,v_other,1,now()+interval '1 day','Consumed');
 insert into public.transfer(transfer_id,request_id,asset_id,approval_id,approver_id,reservation_id,
  sending_department_id,receiving_department_id,quantity,transfer_status,received_by,received_at,received_quantity)
 values(v_transfer,v_q1,v_asset,v_a1,v_other,v_res,v_from,v_to,1,'Completed',v_owner,now(),1);
 update public.resource_request set request_status='Fulfilled' where request_id=v_q1;
 if public.shaikha_emit_notification('received',v_transfer)<>1 then raise exception 'FAIL: receipt emission'; end if;
 if public.shaikha_emit_notification('received',v_transfer)<>0 then raise exception 'FAIL: receipt deduplication'; end if;
 if (select count(*) from public.shaikha_notification where recipient_id=v_owner)<>5 then
  raise exception 'FAIL: four event types did not produce five expected notices';
 end if;
 if (select count(distinct event_type) from public.shaikha_notification where recipient_id=v_owner)<>4 then
  raise exception 'FAIL: event coverage';
 end if;
 select notification_id into v_notice from public.shaikha_notification where recipient_id=v_owner
  and event_type='submitted' and request_id=v_q1;
 perform set_config('shaikha.c8_notice',v_notice::text,true);
 select notification_id into v_notice from public.shaikha_notification where recipient_id=v_owner
  and event_type='submitted' and request_id=v_q2;
 perform set_config('shaikha.c8_foreign_notice',v_notice::text,true);
 -- Only in this disposable DB: enough rolled-back fixtures for two pages.
 for v_count in 1..51 loop
  v_new := gen_random_uuid();
  insert into public.resource_request(request_id,requesting_department_id,submitted_by,
   requested_category_id,specifications,quantity,purpose,urgency,request_status,submitted_at)
  values(v_new,v_to,v_owner,v_category,'Fictional pagination fixture',1,'Isolated C8 test','Normal','Submitted',now());
 end loop;
 raise notice 'PASS: producer supports all four event types and sequential deduplication';
end;
$$;

savepoint c8_atomic_submission;
insert into public.resource_request(request_id,requesting_department_id,submitted_by,
 requested_category_id,specifications,quantity,purpose,urgency,request_status,submitted_at)
values(current_setting('shaikha.c8_rollback_request')::uuid,current_setting('shaikha.c8_to_department')::uuid,
 current_setting('shaikha.c8_owner')::uuid,current_setting('shaikha.c8_category')::uuid,
 'Rollback fixture',1,'Isolated C8 test','Normal','Submitted',now());
rollback to savepoint c8_atomic_submission;
do $$ begin
 if exists(select 1 from public.resource_request where request_id=current_setting('shaikha.c8_rollback_request')::uuid)
 or exists(select 1 from public.shaikha_notification where request_id=current_setting('shaikha.c8_rollback_request')::uuid) then
  raise exception 'FAIL: submission/notification rollback not atomic';
 end if;
 raise notice 'PASS: submission and its notification roll back together';
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('shaikha.c8_owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('shaikha.c8_owner'),'role','authenticated')::text,true);
do $$
declare first_page jsonb; next_page jsonb; v_cursor jsonb;
begin
 first_page := public.shaikha_notification_inbox();
 if (first_page->>'unread_count')::integer<>56 or jsonb_array_length(first_page->'items')<>50
  or not (first_page->>'has_more')::boolean then raise exception 'FAIL: first inbox page'; end if;
 v_cursor := first_page->'next_cursor';
 next_page := public.shaikha_notification_inbox('all',(v_cursor->>'created_at')::timestamptz,(v_cursor->>'notification_id')::uuid);
 if jsonb_array_length(next_page->'items')<>6 or (next_page->>'has_more')::boolean then
  raise exception 'FAIL: second inbox page'; end if;
 if exists(select 1 from jsonb_array_elements(first_page->'items') a
  join jsonb_array_elements(next_page->'items') b on a->>'notification_id'=b->>'notification_id') then
  raise exception 'FAIL: pagination duplicates'; end if;
 if not public.shaikha_mark_notification_read(current_setting('shaikha.c8_notice')::uuid) then
  raise exception 'FAIL: owner read'; end if;
 if public.shaikha_mark_notification_read(current_setting('shaikha.c8_notice')::uuid) then
  raise exception 'FAIL: owner read idempotency'; end if;
 if (public.shaikha_notification_inbox('unread')->>'unread_count')::integer<>55 then raise exception 'FAIL: unread count'; end if;
 begin
  perform notification_id from public.shaikha_notification limit 1;
  raise exception 'FAIL: direct table read unexpectedly allowed';
 exception when insufficient_privilege then null; end;
 begin
  perform public.shaikha_emit_notification('approved',current_setting('shaikha.c8_approval')::uuid);
  raise exception 'FAIL: client producer unexpectedly allowed';
 exception when insufficient_privilege then null; end;
 begin
  update public.shaikha_notification set recipient_id=current_setting('shaikha.c8_other')::uuid
   where notification_id=current_setting('shaikha.c8_notice')::uuid;
  raise exception 'FAIL: direct table update grant unexpectedly available';
 exception when insufficient_privilege then null; end;
 begin
  delete from public.shaikha_notification where notification_id=current_setting('shaikha.c8_notice')::uuid;
  raise exception 'FAIL: direct table delete grant unexpectedly available';
 exception when insufficient_privilege then null; end;
 raise notice 'PASS: owner inbox, two pages, read persistence/idempotency and table/producer ACLs';
end $$;

select set_config('request.jwt.claim.sub',current_setting('shaikha.c8_other'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('shaikha.c8_other'),'role','authenticated')::text,true);
do $$ begin
 if jsonb_array_length(public.shaikha_notification_inbox()->'items')<>0 then
  raise exception 'FAIL: different admin account can see owner inbox'; end if;
 if public.shaikha_mark_notification_read(current_setting('shaikha.c8_foreign_notice')::uuid) then
  raise exception 'FAIL: foreign mark-read'; end if;
 raise notice 'PASS: another account, including an admin, cannot read or change owner notices';
end $$;

set local role anon;
do $$ begin
 begin perform public.shaikha_notification_inbox(); raise exception 'FAIL: anonymous inbox allowed';
 exception when insufficient_privilege then null; end;
 begin perform public.shaikha_mark_notification_read(current_setting('shaikha.c8_foreign_notice')::uuid);
  raise exception 'FAIL: anonymous mark allowed'; exception when insufficient_privilege then null; end;
 raise notice 'PASS: anonymous inbox and read update denied';
end $$;

reset role;
-- Test active-profile enforcement using ONLY our disposable fixture user.
update public.app_user set account_status='inactive' where user_id=current_setting('shaikha.c8_owner')::uuid;
set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('shaikha.c8_owner'),true);
select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('shaikha.c8_owner'),'role','authenticated')::text,true);
do $$ begin
 begin perform public.shaikha_notification_inbox(); raise exception 'FAIL: inactive account allowed';
 exception when insufficient_privilege then null; end;
 raise notice 'PASS: inactive account denied';
end $$;
reset role;
-- Every fixture, notification, role assignment and fake auth user is undone.
rollback;
