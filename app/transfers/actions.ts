"use server";

import { revalidatePath } from "next/cache";
import { AuthService } from "@/lib/auth/AuthService";
import { createClient } from "@/lib/supabase/server";
import type { FormState } from "./types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// We use the signed-in user's session. Every RPC repeats authorization and state checks.
export async function transferAction(_previous: FormState, form: FormData): Promise<FormState> {
  await AuthService.requireRole("requester", "custodian", "approver", "admin");
  const text = (key: string) => typeof form.get(key) === "string" ? String(form.get(key)).trim() : "";
  const id = text("id");
  if (!uuid.test(id)) return { ok: false, message: "Invalid record. Refresh the page." };
  const operation = text("operation");
  const supabase = await createClient();
  let rpc: string;
  let args: Record<string, unknown>;
  let message: string;
  switch (operation) {
    case "create":
      rpc = "renad_create_transfer"; args = { p_reservation: id }; message = "Transfer created. Record the collection arrangements next."; break;
    case "schedule": {
      const cost = Number(text("cost"));
      if (!uuid.test(text("receiver")) || !uuid.test(text("custodian")) || !text("cost") || !Number.isFinite(cost) || cost < 0)
        return { ok: false, message: "Choose a receiver and receiving custodian, and enter a valid cost (zero is allowed)." };
      rpc = "renad_schedule_transfer";
      args = { p_transfer: id, p_date: text("date") || null, p_destination: text("location"),
        p_receiver: text("receiver"), p_custodian: text("custodian"), p_notes: text("notes"), p_cost: cost, p_document: text("document") };
      message = "Collection arrangements saved."; break;
    }
    case "release":
      if (text("confirmed") !== "on") return { ok: false, message: "Confirm the physical handover first." };
      rpc = "renad_release_transfer"; args = { p_transfer: id }; message = "Handover recorded. The named receiver must confirm receipt."; break;
    case "cancel": case "expire":
      rpc = "renad_cancel_transfer"; args = { p_transfer: id, p_expired: operation === "expire", p_reason: text("reason") };
      message = operation === "expire" ? "Expired transfer hold released; request is Approved again." : "Transfer and request cancelled; held stock restored."; break;
    case "resolve":
      rpc = "renad_resolve_discrepancy"; args = { p_discrepancy: id, p_resolution: text("reason") };
      message = "Resolution recorded. The receiver must confirm receipt again."; break;
    case "receive": {
      const quantity = Number(text("quantity"));
      if (!text("quantity") || !Number.isSafeInteger(quantity) || quantity < 0)
        return { ok: false, message: "Enter the total quantity received as a whole number." };
      rpc = "renad_receive_transfer"; args = { p_transfer: id, p_quantity: quantity, p_condition: text("condition"),
        p_location: text("location"), p_has_problem: text("problem") === "on", p_note: text("reason") };
      message = "Receipt saved."; break;
    }
    case "item_type":
      rpc = "renad_confirm_item_type"; args = { p_request: id, p_item_type: text("item_type") };
      message = "Item type confirmed. The custodian can now verify the asset's actual specifications."; break;
    case "verify": {
      if (!uuid.test(text("asset"))) return { ok: false, message: "Select an asset." };
      // Actual values are entered by an authorized custodian; never copy requested values automatically.
      const specifications: Record<string, string | number | boolean> = {};
      for (const [key, raw] of form.entries()) {
        if (!key.startsWith("spec:")) continue;
        const [, field, kind] = key.split(":");
        if (!/^[a-z][a-z0-9_]{0,63}$/.test(field) || typeof raw !== "string" || !raw.trim()) continue;
        if (kind === "number") {
          const number = Number(raw);
          if (!Number.isFinite(number)) return { ok: false, message: `Enter a valid number for ${field}.` };
          specifications[field] = number;
        } else if (kind === "boolean") {
          if (!["true", "false"].includes(raw)) return { ok: false, message: `Choose yes or no for ${field}.` };
          specifications[field] = raw === "true";
        } else specifications[field] = field === "item_type" ? raw.trim().toLowerCase() : raw.trim();
      }
      rpc = "renad_verify_asset";
      args = { p_request: id, p_asset: text("asset"), p_specifications: specifications, p_safety: text("safety"),
        p_inspection_required: text("inspection") === "yes" ? true : text("inspection") === "no" ? false : null,
        p_inspected_on: text("inspected_on") || null, p_inspection_valid_until: text("inspection_until") || null,
        p_receipt_date: text("receipt_date") || null, p_valid_until: text("valid_until") || null,
        p_source: text("source"), p_verified: text("verified") === "on" };
      message = "Asset facts saved. Eligibility is checked against the request; saving facts does not guarantee a match."; break;
    }
    default: return { ok: false, message: "Choose a valid action." };
  }
  try {
    const { data, error } = await supabase.rpc(rpc, args);
    if (error) return { ok: false, message: ["22023", "42501"].includes(error.code) ? error.message :
      "Could not confirm this change. Refresh before retrying and check that the required migrations have been applied." };
    if (operation === "receive") message = data === "Completed" ? "Receipt confirmed. Ownership, custody, department and stock are updated." :
      "Discrepancy recorded. An approver must resolve it before you confirm receipt again.";
    for (const path of ["/transfers", "/approvals", "/protected/requests", "/assets", "/search"]) revalidatePath(path);
    return { ok: true, message };
  } catch {
    return { ok: false, message: "Connection interrupted. Refresh to check the saved state before retrying." };
  }
}
