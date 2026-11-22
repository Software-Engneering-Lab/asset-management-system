"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { loadInbox, markNotificationRead } from "./actions";
import { mergeNotices, noticeText, type Inbox, type InboxFilter, type Notice } from "./notification-model";

export default function NotificationsPage() {
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [items, setItems] = useState<Notice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const running = useRef(false);

  async function refresh(selected: InboxFilter = filter) {
    const result = await loadInbox({ filter: selected, cursor: null });
    if (!result.success) { setInbox(null); setItems([]); setError(result.message); return false; }
    setInbox(result.inbox); setItems(result.inbox.items); return true;
  }
  async function runLoad(selected: InboxFilter = filter, more = false) {
    if (running.current || (more && (!inbox?.next_cursor || inbox.filter !== selected))) return;
    running.current = true; setBusy(true); setError(""); setMessage("");
    try {
      if (more && inbox?.next_cursor) {
        const result = await loadInbox({ filter: selected, cursor: inbox.next_cursor });
        if (result.success) { setInbox(result.inbox); setItems((old) => mergeNotices(old, result.inbox.items)); }
        else setError(result.message);
      } else await refresh(selected);
    } catch { setError("Inbox could not be refreshed. Previously loaded items may be out of date."); }
    finally { running.current = false; setBusy(false); }
  }
  useEffect(() => {
    let active = true;
    running.current = true;
    setBusy(true);
    void loadInbox({ filter: "all", cursor: null }).then((result) => {
      if (!active) return;
      if (result.success) { setInbox(result.inbox); setItems(result.inbox.items); }
      else setError(result.message);
    }).catch(() => {
      if (active) setError("Inbox could not be loaded. Please refresh.");
    }).finally(() => {
      if (active) { running.current = false; setBusy(false); }
    });
    return () => { active = false; };
  }, []);

  async function markRead(id: string) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const result = await markNotificationRead(id);
      if (!result.success) { setError(result.message); return; }
      const refreshed = await refresh(filter);
      if (refreshed) setMessage(result.changed ? "Marked as read. Inbox refreshed from the first page." : "Already read or no longer available. Inbox refreshed.");
      else setMessage("Read update returned, but refresh failed. Refresh to confirm the current inbox.");
    } catch { setError("Read update could not be confirmed. Refresh before retrying."); }
    finally { running.current = false; setBusy(false); }
  }
  function changeFilter(next: InboxFilter) {
    if (running.current) return;
    setFilter(next); void runLoad(next);
  }

  return <section className="w-full space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold">My notifications</h1>
        <p className="mt-2 text-sm text-muted-foreground">Only notifications addressed to your account. Refresh to see new events.</p>
        {inbox && <p className="mt-2 font-medium">Unread: {inbox.unread_count}</p>}
      </div>
      <button disabled={busy} onClick={() => void runLoad()} className="rounded-md border px-4 py-2 disabled:opacity-50">{busy ? "Loading…" : "Refresh"}</button>
    </header>
    <div className="flex items-center gap-3">
      <label htmlFor="notification-filter">Show</label>
      <select id="notification-filter" value={filter} disabled={busy} onChange={(event) => changeFilter(event.target.value as InboxFilter)} className="rounded-md border bg-background px-3 py-2">
        <option value="all">All notifications</option><option value="unread">Unread only</option>
      </select>
      <Link href="/protected/requests" className="text-sm underline">My requests</Link>
    </div>
    {error && <p role="alert" className="rounded-md border border-red-500 p-3">{error}</p>}
    <p role="status" className="text-sm">{message}</p>
    {inbox && <>
      <p className="text-xs text-muted-foreground">Loaded at {new Date(inbox.loaded_at).toLocaleString()}. These are event notices, not live workflow status. Older events are not automatically backfilled.</p>
      {items.length === 0 ? <p className="rounded-md border p-5">{filter === "unread" ? "You have no unread notifications." : "You have no notifications yet."}</p> :
        <ul className="space-y-3">{items.map((item) => {
          const text = noticeText(item.event_type);
          return <li key={item.notification_id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="font-semibold">{text.title} <span className="ml-2 text-xs font-normal">{item.read_at === null ? "Unread" : "Read"}</span></h2>
              {item.read_at === null && <button disabled={busy} onClick={() => void markRead(item.notification_id)} aria-label={`Mark ${text.title.toLowerCase()} for request ${item.request_id} as read`} className="rounded-md border px-3 py-1 text-sm disabled:opacity-50">Mark as read</button>}
            </div>
            <p className="mt-2 text-sm">{text.body}</p>
            <p className="mt-2 break-all text-xs text-muted-foreground">Request: {item.request_id}</p>
            {item.approval_id && <p className="mt-1 break-all text-xs text-muted-foreground">Approval: {item.approval_id}</p>}
            {item.transfer_id && <p className="mt-1 break-all text-xs text-muted-foreground">Transfer: {item.transfer_id}</p>}
            <p className="mt-2 text-xs text-muted-foreground">Event: {new Date(item.event_at).toLocaleString()} · Delivered: {new Date(item.created_at).toLocaleString()}</p>
          </li>;
        })}</ul>}
      <p className="text-sm">Showing {items.length} loaded notifications. Newest first; up to 50 per load.</p>
      {inbox.has_more && <button disabled={busy} onClick={() => void runLoad(filter, true)} className="rounded-md border px-4 py-2 disabled:opacity-50">Load older notifications</button>}
    </>}
  </section>;
}
