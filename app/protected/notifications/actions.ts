"use server";

import { createClient } from "@/lib/supabase/server";
import { parseInbox, parseInboxInput, validId, type Inbox, type InboxInput } from "./notification-model";

function failure(code?: string) {
  if (code === "42501") return "An active account, department and application role are required for notifications.";
  if (code === "PGRST202" || code === "42883") return "Notifications are not enabled yet. The new reviewed C8 migration must be applied once.";
  return "Notifications could not be loaded or updated. Refresh before retrying.";
}

export async function loadInbox(input: InboxInput): Promise<{ success: true; inbox: Inbox } | { success: false; message: string }> {
  try {
    const checked = parseInboxInput(input);
    const db = await createClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return { success: false, message: "Please sign in." };
    const { data, error } = await db.rpc("shaikha_notification_inbox", {
      p_filter: checked.filter, p_before_created_at: checked.cursor?.created_at ?? null,
      p_before_id: checked.cursor?.notification_id ?? null,
    });
    if (error) return { success: false, message: failure(error.code) };
    return { success: true, inbox: parseInbox(data, checked) };
  } catch { return { success: false, message: failure() }; }
}

export async function markNotificationRead(id: string): Promise<{ success: true; changed: boolean } | { success: false; message: string }> {
  if (!validId(id)) return { success: false, message: "Invalid notification reference." };
  try {
    const db = await createClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return { success: false, message: "Please sign in." };
    const { data, error } = await db.rpc("shaikha_mark_notification_read", { p_notification_id: id });
    if (error) return { success: false, message: failure(error.code) };
    if (typeof data !== "boolean") return { success: false, message: failure() };
    return { success: true, changed: data };
  } catch { return { success: false, message: failure() }; }
}
