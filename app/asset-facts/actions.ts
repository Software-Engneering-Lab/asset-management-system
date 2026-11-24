"use server";

import { revalidatePath } from "next/cache";
import { AuthService } from "@/lib/auth/AuthService";
import { createClient } from "@/lib/supabase/server";

export type FactsState = { ok: boolean; message: string };

function value(form: FormData, key: string): string {
  const raw = form.get(key);
  return typeof raw === "string" ? raw.trim() : "";
}

function dateOrNull(s: string): string | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error("Invalid date format.");
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.valueOf()) || d.toISOString().slice(0, 10) !== s) {
    throw new Error("Invalid date.");
  }
  return s;
}

export async function saveAssetFacts(_previous: FactsState, form: FormData): Promise<FactsState> {
  await AuthService.requireRole("admin", "custodian");
  const asset = value(form, "asset_id");
  const itemType = value(form, "item_type").toLowerCase();
  const source = value(form, "source");
  const safety = value(form, "safety");
  const inspectionRequired = value(form, "inspection_required") === "yes";
  const inspectionResult = value(form, "inspection_result") || "unknown";
  if (!asset || !itemType || itemType.length > 80 || !source || source.length > 1000) {
    return { ok: false, message: "Choose an asset, enter its actual item type and evidence source." };
  }
  if (!["clear", "restricted", "unknown"].includes(safety)) {
    return { ok: false, message: "Choose a verified safety status." };
  }
  if (inspectionRequired && !["passed", "failed", "unknown"].includes(inspectionResult)) {
    return { ok: false, message: "Choose the inspection result." };
  }
  let specifications: Record<string, string | number | boolean>;
  let inspectedOn: string | null;
  let inspectionUntil: string | null;
  let earliestReceipt: string | null;
  let validUntil: string | null;
  try {
    const extra = value(form, "extra_specs");
    const parsed: unknown = extra ? JSON.parse(extra) : {};
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Additional specifications must be a JSON object.");
    }
    specifications = { item_type: itemType };
    for (const [key, item] of Object.entries(parsed)) {
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
          !["string", "number", "boolean"].includes(typeof item) ||
          (typeof item === "number" && !Number.isFinite(item))) {
        throw new Error("Use lowercase specification keys and flat text, number or boolean values.");
      }
      if (key !== "item_type") specifications[key] = item as string | number | boolean;
    }
    inspectedOn = dateOrNull(value(form, "inspected_on"));
    inspectionUntil = dateOrNull(value(form, "inspection_until"));
    earliestReceipt = dateOrNull(value(form, "earliest_receipt"));
    validUntil = dateOrNull(value(form, "valid_until"));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Invalid specifications or date." };
  }
  if (earliestReceipt && value(form, "campus_wide_confirmed") !== "on") {
    return { ok: false, message: "Only enter an arrival date if delivery to every requesting department is verified; otherwise leave it blank." };
  }
  const db = await createClient();
  const { error } = await db.rpc("renad_record_asset_facts", {
    p_asset: asset,
    p_specifications: specifications,
    p_safety: safety,
    p_inspection_required: inspectionRequired,
    p_inspection_result: inspectionRequired ? inspectionResult : null,
    p_inspected_on: inspectedOn,
    p_inspection_valid_until: inspectionUntil,
    p_earliest_receipt_date: earliestReceipt,
    p_valid_until: validUntil,
    p_source: source,
    p_campus_wide_arrival: earliestReceipt ? true : false,
  });
  if (error) return { ok: false, message: error.message };
  revalidatePath("/asset-facts");
  revalidatePath("/approvals");
  revalidatePath("/transfers");
  return { ok: true, message: "Verified asset facts saved. Eligibility will be checked for each request." };
}
