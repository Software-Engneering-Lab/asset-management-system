// Plain data contract. No credentials, database clients or caller-selected URLs.
export const EVENTS = ["submitted", "approved", "rejected", "received"] as const;
export type NotificationEvent = typeof EVENTS[number];
export type InboxFilter = "all" | "unread";
export type Cursor = { created_at: string; notification_id: string };
export type InboxInput = { filter: InboxFilter; cursor: Cursor | null };
export type Notice = {
  notification_id: string; event_type: NotificationEvent; request_id: string;
  approval_id: string | null; transfer_id: string | null;
  event_at: string; created_at: string; read_at: string | null;
};
export type Inbox = {
  contract_version: "c8-inbox-v1"; filter: InboxFilter; loaded_at: string;
  unread_count: number; has_more: boolean; next_cursor: Cursor | null; items: Notice[];
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function validId(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
function validTime(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
function parseCursor(value: unknown): Cursor {
  if (!object(value) || !validTime(value.created_at) || !validId(value.notification_id)) throw new Error("Invalid inbox cursor.");
  return { created_at: value.created_at, notification_id: value.notification_id };
}
export function parseInboxInput(value: unknown): InboxInput {
  if (!object(value) || (value.filter !== "all" && value.filter !== "unread") || value.cursor === undefined) throw new Error("Invalid inbox filter.");
  return { filter: value.filter, cursor: value.cursor === null ? null : parseCursor(value.cursor) };
}

export function parseInbox(value: unknown, input: InboxInput): Inbox {
  if (!object(value) || value.contract_version !== "c8-inbox-v1" || value.filter !== input.filter ||
      !validTime(value.loaded_at) || typeof value.unread_count !== "number" || !Number.isSafeInteger(value.unread_count) ||
      value.unread_count < 0 || typeof value.has_more !== "boolean" || !Array.isArray(value.items) ||
      value.items.length > 50 || (value.has_more && value.items.length !== 50)) throw new Error("Unexpected inbox response.");
  const seen = new Set<string>();
  const items: Notice[] = value.items.map((row: unknown) => {
    if (!object(row) || !validId(row.notification_id) || seen.has(row.notification_id) || !validId(row.request_id) ||
        typeof row.event_type !== "string" || !(EVENTS as readonly string[]).includes(row.event_type) ||
        !validTime(row.created_at) || !validTime(row.event_at) || !(row.read_at === null || validTime(row.read_at))) throw new Error("Invalid notification.");
    if (!(row.approval_id === null || validId(row.approval_id)) || !(row.transfer_id === null || validId(row.transfer_id)) ||
        (row.event_type === "submitted" && (row.approval_id !== null || row.transfer_id !== null)) ||
        (["approved", "rejected"].includes(row.event_type) && (row.approval_id === null || row.transfer_id !== null)) ||
        (row.event_type === "received" && (row.transfer_id === null || row.approval_id !== null)) ||
        (input.filter === "unread" && row.read_at !== null)) throw new Error("Invalid notification references or read state.");
    seen.add(row.notification_id);
    return { notification_id: row.notification_id, event_type: row.event_type as NotificationEvent,
      request_id: row.request_id, approval_id: row.approval_id as string | null, transfer_id: row.transfer_id as string | null,
      created_at: row.created_at, event_at: row.event_at, read_at: row.read_at as string | null };
  });
  const cursor = value.next_cursor === null ? null : parseCursor(value.next_cursor);
  if (value.has_more !== (cursor !== null)) throw new Error("Invalid pagination state.");
  if (cursor && (cursor.notification_id !== items.at(-1)?.notification_id || cursor.created_at !== items.at(-1)?.created_at)) throw new Error("Cursor does not match last item.");
  if (value.unread_count < items.filter((item) => item.read_at === null).length) throw new Error("Invalid unread count.");
  return { contract_version: "c8-inbox-v1", filter: input.filter, loaded_at: value.loaded_at,
    unread_count: value.unread_count, has_more: value.has_more, next_cursor: cursor, items };
}

export function noticeText(event: NotificationEvent): { title: string; body: string } {
  switch (event) {
    case "submitted": return { title: "Request submitted", body: "Your resource request was submitted successfully." };
    case "approved": return { title: "Request approved", body: "An approval was recorded for your request. Approval does not mean the transfer has been received." };
    case "rejected": return { title: "Request rejected", body: "Your request was rejected. Check your request status and review details." };
    case "received": return { title: "Receipt recorded", body: "Receipt was recorded for a transfer linked to your request. Check its final status, including any discrepancy." };
  }
}
export function mergeNotices(current: Notice[], incoming: Notice[]): Notice[] {
  const existing = new Set(current.map((item) => item.notification_id));
  return [...current, ...incoming.filter((item) => !existing.has(item.notification_id))];
}
