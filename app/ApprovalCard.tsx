"use server";

import { revalidatePath } from "next/cache";
import { AuthService } from "@/lib/auth/AuthService";
import { createClient } from "@/lib/supabase/server";
import type { ApprovalFormState } from "@/lib/approvals/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Browser validation is convenient; the database repeats all security/business checks.
export async function submitApprovalAction(
  _previous: ApprovalFormState,
  form: FormData,
): Promise<ApprovalFormState> {
  await AuthService.requireRole("approver", "admin");
  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const requestId = text("request_id");
  const operation = text("operation");
  const reason = text("reason");
  if (!uuid.test(requestId)) return { ok: false, message: "Invalid request. Refresh the page." };

  const supabase = await createClient();
  let error;
  let message = "Saved.";
  try {
    if (operation === "review") {
      ({ error } = await supabase.rpc("renad_start_review", { p_request_id: requestId }));
      message = "Request is now under review.";
    } else if (operation === "approve" || operation === "reject" || operation === "return") {
      if (!reason || reason.length > 1000) return { ok: false, message: "Enter a reason (1–1,000 characters)." };
      const assetId = text("asset_id");
      if (operation === "approve" && !uuid.test(assetId)) return { ok: false, message: "Select an eligible asset." };
      const decision = operation === "approve" ? "Approved" : operation === "reject" ? "Rejected" : "Returned for Information";
      if (operation === "approve") {
        const hours = Number(text("expiry_hours"));
        if (!Number.isInteger(hours) || hours < 1 || hours > 168) return { ok: false, message: "Enter an expiry between 1 and 168 hours." };
        ({ error } = await supabase.rpc("renad_approve_and_reserve", {
          p_request_id: requestId, p_asset_id: assetId, p_reason: reason,
          p_expires_at: new Date(Date.now() + hours * 3600000).toISOString(),
        }));
      } else {
        ({ error } = await supabase.rpc("renad_decide_request", {
          p_request_id: requestId, p_decision: decision, p_asset_id: null, p_reason: reason,
        }));
      }
      message = operation === "approve" ? "Approved and reserved. Both steps were saved together." : `Decision saved: ${decision}.`;
    } else if (operation === "reserve") {
      const hours = Number(text("expiry_hours"));
      if (!Number.isInteger(hours) || hours < 1 || hours > 168) return { ok: false, message: "Enter an expiry between 1 and 168 hours." };
      // Duration avoids confusion between the browser's and server's time zones.
      const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      ({ error } = await supabase.rpc("renad_reserve_asset", {
        p_request_id: requestId, p_expires_at: expiresAt,
      }));
      message = "Reservation saved. The reserved stock cannot be allocated again.";
    } else if (operation === "cancel" || operation === "expire") {
      if (!reason || reason.length > 1000) return { ok: false, message: "Enter a reason (1–1,000 characters)." };
      ({ error } = await supabase.rpc("renad_end_reservation", {
        p_request_id: requestId, p_expired: operation === "expire", p_reason: reason,
      }));
      message = operation === "expire" ? "Expired hold released. Request is Approved again." : "Request cancelled; any held stock was restored.";
    } else {
      return { ok: false, message: "Choose a valid action." };
    }
    if (error) {
      const expected = ["22023", "42501"].includes(error.code);
      return { ok: false, message: expected ? error.message : "The operation could not be confirmed. Refresh before retrying; check that the approval migration is installed." };
    }
  } catch {
    return { ok: false, message: "Connection interrupted. Refresh to check the request before retrying." };
  }
  // Shaikha's tracking and Budoor's stock screens use the same records.
  for (const path of ["/approvals", "/protected/requests", "/assets", "/search"]) revalidatePath(path);
  return { ok: true, message };
}
