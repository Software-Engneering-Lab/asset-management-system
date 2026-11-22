import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EVENTS, validId, parseInboxInput, parseInbox, noticeText, mergeNotices } from '../app/protected/notifications/notification-model.ts';

const id = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = { filter: 'all', cursor: null };
const time = '2026-11-22T11:00:00.123456+00:00';
const notice = (n = 1, event = 'submitted') => ({ notification_id: id(n), event_type: event,
  request_id: id(90), approval_id: ['approved','rejected'].includes(event) ? id(91) : null,
  transfer_id: event === 'received' ? id(92) : null, event_at: time, created_at: time, read_at: null });
const inbox = (items = [notice()], patch = {}) => ({ contract_version: 'c8-inbox-v1', filter: 'all',
  loaded_at: time, unread_count: items.filter(x => x.read_at === null).length,
  has_more: false, next_cursor: null, items, ...patch });

test('strict UUIDs reject URLs and malformed IDs', () => {
  assert.equal(validId(id()), true);
  for (const value of ['', null, 1, '../requests', 'javascript:alert(1)', '<script>']) assert.equal(validId(value), false);
});
test('inbox accepts only all/unread and complete cursor contracts', () => {
  assert.deepEqual(parseInboxInput(input), input);
  for (const value of [{ filter: 'everyone', cursor: null }, { filter: 'all' }, { filter: 'all', cursor: {} },
    { filter: 'all', cursor: { created_at: time, notification_id: 'invalid' } }, null])
    assert.throws(() => parseInboxInput(value));
});
test('cursor keeps exact microsecond timestamp, avoiding millisecond skips', () => {
  const cursor = { created_at: time, notification_id: id() };
  assert.deepEqual(parseInboxInput({ ...input, cursor }).cursor, cursor);
});
test('all four event types have valid typed references', () => {
  for (const event of EVENTS) assert.equal(parseInbox(inbox([notice(1,event)]), input).items[0].event_type, event);
});
test('unrequested payload fields and sender URLs never reach UI model', () => {
  const parsed = parseInbox(inbox([{ ...notice(), href: 'javascript:alert(1)', body: '<script>', recipient_id: id(7) }]), input);
  assert.equal(parsed.items[0].href, undefined);
  assert.equal(parsed.items[0].body, undefined);
  assert.equal(parsed.items[0].recipient_id, undefined);
});
test('empty inbox and zero unread are valid, not missing data', () => {
  assert.equal(parseInbox(inbox([]), input).unread_count, 0);
  assert.equal(parseInbox(inbox([]), input).items.length, 0);
});
test('contract version, returned filter and loaded timestamp are checked', () => {
  for (const patch of [{ contract_version: 'legacy' }, { filter: 'unread' }, { loaded_at: 'yesterday' }])
    assert.throws(() => parseInbox(inbox([],patch), input));
});
test('unread counts must be nonnegative safe integers, not strings or missing', () => {
  for (const unread_count of [-1, 0.5, '1', null, undefined, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => parseInbox(inbox([], { unread_count }), input));
  assert.throws(() => parseInbox(inbox([notice()], { unread_count: 0 }), input));
});
test('duplicate notification IDs and unknown events fail closed', () => {
  assert.throws(() => parseInbox(inbox([notice(), notice()]), input));
  assert.throws(() => parseInbox(inbox([notice(1,'invented')]), input));
});
test('submitted notifications cannot masquerade as approval or transfer events', () => {
  for (const patch of [{ approval_id: id(3) }, { transfer_id: id(4) }, { request_id: null }])
    assert.throws(() => parseInbox(inbox([{ ...notice(), ...patch }]), input));
});
test('approved and rejected notifications require an approval ID, not transfer ID', () => {
  for (const event of ['approved', 'rejected']) {
    assert.throws(() => parseInbox(inbox([{ ...notice(1,event), approval_id: null }]), input));
    assert.throws(() => parseInbox(inbox([{ ...notice(1,event), transfer_id: id(4) }]), input));
  }
});
test('receipt notifications require a transfer ID', () => {
  assert.throws(() => parseInbox(inbox([{ ...notice(1,'received'), transfer_id: null }]), input));
});
test('read timestamp must be a timestamp or explicit null', () => {
  assert.ok(parseInbox(inbox([{ ...notice(), read_at: time }]), input));
  for (const read_at of [undefined, false, '', '2026-11-22'])
    assert.throws(() => parseInbox(inbox([{ ...notice(), read_at }]), input));
});
test('unread filter rejects read records', () => {
  const unread = { filter: 'unread', cursor: null };
  assert.throws(() => parseInbox(inbox([{ ...notice(), read_at: time }], { filter: 'unread' }), unread));
});
test('pages are bounded to fifty items with consistent has_more state', () => {
  assert.throws(() => parseInbox(inbox(Array.from({length:51},(_,i)=>notice(i+1))), input));
  assert.throws(() => parseInbox(inbox([], { has_more: true }), input));
  assert.throws(() => parseInbox(inbox([], { next_cursor: {created_at:time, notification_id:id()} }), input));
});
test('next cursor identifies last returned row with original timestamp precision', () => {
  const items = Array.from({length:50},(_,i)=>notice(i+1));
  const next_cursor = { created_at: time, notification_id: id(50) };
  assert.ok(parseInbox(inbox(items,{has_more:true,next_cursor}),input));
  assert.throws(()=>parseInbox(inbox(items,{has_more:true,next_cursor:{...next_cursor,notification_id:id(1)}}),input));
});
test('appending older pages deduplicates already loaded IDs without reordering', () => {
  assert.deepEqual(mergeNotices([notice(1),notice(2)],[notice(2),notice(3)]).map(x=>x.notification_id),[id(1),id(2),id(3)]);
});
test('notification copy does not claim approval is receipt or discrepancy is success', () => {
  assert.match(noticeText('approved').body,/does not mean/);
  assert.match(noticeText('received').body,/discrepancy/);
  assert.equal(noticeText('submitted').title,'Request submitted');
});

// Source-level regression guards, NOT a substitute for executing PostgreSQL
// permission, rollback and race tests against an isolated test database.
const sql = readFileSync(new URL('../supabase/migrations/20261122180000_shaikha_notifications.sql',import.meta.url),'utf8');
test('SQL includes recipient-bound inbox and read updates plus idempotent source key', () => {
  assert.match(sql,/unique\(recipient_id,event_type,source_event_id\)/);
  assert.match(sql,/notification_id=p_notification_id and recipient_id=v_user and read_at is null/);
  assert.match(sql,/n.recipient_id=v_user/);
  assert.match(sql,/on conflict\(recipient_id,event_type,source_event_id\) do nothing/);
});
test('SQL does not grant client event production, direct writes or bypass RLS', () => {
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on table public.shaikha_notification from public,anon,authenticated,service_role/);
  assert.match(sql,/revoke all on function public.shaikha_emit_notification\(text,uuid\) from public,anon,authenticated,service_role/);
  assert.doesNotMatch(sql,/grant execute on function public.shaikha_emit_notification/i);
  assert.doesNotMatch(sql,/disable row level security|create or replace/i);
});
test('only submission is automatically hooked; no foreign workflow trigger is installed', () => {
  const triggers = [...sql.matchAll(/create trigger (\w+)/gi)].map(x=>x[1]);
  assert.deepEqual(triggers,['shaikha_request_submission_notice']);
  assert.match(sql,/after insert or update of request_status,submitted_at on public.resource_request/);
});
