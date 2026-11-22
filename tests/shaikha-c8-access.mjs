// Normal demo-user JWTs and public key ONLY. No role changes or business writes.
// This test intentionally marks the owner's selected notification as read.
import assert from 'node:assert/strict';
import { parseInbox, validId } from '../app/protected/notifications/notification-model.ts';

async function main() {
  const env = process.env;
  const base = env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const targetRequest = env.shaikhaC8RequestId;
  if (!base || !key || !env.shaikhaC8OwnerEmail || !env.shaikhaC8OwnerPassword ||
      !env.shaikhaC8OtherEmail || !env.shaikhaC8OtherPassword || !validId(targetRequest))
    throw new Error('Missing test settings. Follow docs/SHAIKHA_C8_HANDOFF.md.');
  const url = new URL(base);
  if (!['http:','https:'].includes(url.protocol)) throw new Error('Invalid configured URL.');
  async function call(path, body, token, method = 'POST') {
    const response = await fetch(new URL(path,url), { method,
      headers: { apikey:key, 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) },
      ...(method === 'GET' ? {} : { body:JSON.stringify(body) }), signal:AbortSignal.timeout(20000) });
    return { ok:response.ok, data:await response.json() };
  }
  const inboxArgs = { p_filter:'all', p_before_created_at:null, p_before_id:null };
  const input = { filter:'all', cursor:null };
  async function login(email,password) {
    const result = await call('/auth/v1/token?grant_type=password',{email,password});
    if (!result.ok || !result.data?.access_token || !result.data?.user?.id) throw new Error('Demo login failed. Check the authorized credentials.');
    return { token:result.data.access_token, user:result.data.user.id };
  }
  async function getInbox(token) {
    const result = await call('/rest/v1/rpc/shaikha_notification_inbox',inboxArgs,token);
    assert.equal(result.ok,true,'Signed-in inbox failed; check active profile, department, role and migration.');
    return parseInbox(result.data,input);
  }
  async function denied(result,label) {
    assert.equal(result.ok,false,`${label} unexpectedly allowed.`);
    assert.equal(result.data?.code,'42501',`${label}: expected permission denial, not a setup/connection failure.`);
    console.log(`PASS: ${label} denied`);
  }
  await denied(await call('/rest/v1/rpc/shaikha_notification_inbox',inboxArgs),'Anonymous inbox');
  const owner = await login(env.shaikhaC8OwnerEmail,env.shaikhaC8OwnerPassword);
  const other = await login(env.shaikhaC8OtherEmail,env.shaikhaC8OtherPassword);
  assert.notEqual(owner.user,other.user,'Choose two DIFFERENT demo accounts.');
  const before = await getInbox(owner.token);
  const selected = before.items.find(n=>n.request_id === targetRequest && n.event_type === 'submitted');
  assert.ok(selected,'No submission notice in first 50 items for this request. Submit a NEW demo request after applying C8.');
  assert.equal(selected.read_at,null,'Selected notice is already read. Create a fresh demo request for this test.');
  console.log('PASS: owner received a submission notification');
  const otherInbox = await getInbox(other.token);
  assert.ok(!otherInbox.items.some(n=>n.notification_id === selected.notification_id),'Another user can see the owner notice.');
  const foreignMark = await call('/rest/v1/rpc/shaikha_mark_notification_read', {p_notification_id:selected.notification_id},other.token);
  assert.equal(foreignMark.ok,true,'Foreign-mark test failed for an unrelated reason.');
  assert.equal(foreignMark.data,false,'Another user changed the owner notice.');
  const stillUnread = (await getInbox(owner.token)).items.find(n=>n.notification_id === selected.notification_id);
  assert.ok(stillUnread,'Owner notice is unexpectedly missing.');
  assert.equal(stillUnread.read_at,null,'Foreign attempt changed read status.');
  console.log('PASS: second account cannot read or mark the owner notice');
  await denied(await call('/rest/v1/rpc/shaikha_mark_notification_read',{p_notification_id:selected.notification_id}),'Anonymous mark-read');
  await denied(await call('/rest/v1/shaikha_notification?select=notification_id&limit=1',null,owner.token,'GET'),'Direct table read');
  // Source is the existing, deduplicated submission, so even a broken producer
  // ACL would not create a new event during this negative test.
  await denied(await call('/rest/v1/rpc/shaikha_emit_notification',{p_event:'submitted',p_source_id:targetRequest},owner.token),'Client event producer');
  for (const [iteration,expected] of [[1,true],[2,false]]) {
    const mark = await call('/rest/v1/rpc/shaikha_mark_notification_read',{p_notification_id:selected.notification_id},owner.token);
    assert.equal(mark.ok,true,'Owner read update failed.');
    assert.equal(mark.data,expected,`Owner read attempt ${iteration} was not idempotent.`);
  }
  const after = await getInbox(owner.token);
  assert.ok(after.items.find(n=>n.notification_id === selected.notification_id)?.read_at,'Read status did not persist.');
  console.log('PASS: owner mark-read persists and repeated mark-read is idempotent');
  const unreadResult = await call('/rest/v1/rpc/shaikha_notification_inbox',{...inboxArgs,p_filter:'unread'},owner.token);
  assert.equal(unreadResult.ok,true,'Unread inbox failed.');
  const unread = parseInbox(unreadResult.data,{filter:'unread',cursor:null});
  assert.ok(!unread.items.some(n=>n.notification_id === selected.notification_id),'Read notice remains in unread filter.');
  console.log('PASS: unread filter excludes the read notice');
  console.log('DONE: C8 submission/inbox access checks passed. Renad workflow event tests remain separate.');
}
main().catch(error=>{ console.error(`STOP: ${error instanceof Error ? error.message : 'Access test failed.'}`); process.exitCode=1; });
