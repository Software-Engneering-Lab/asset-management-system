"use server";

import { redirect } from "next/navigation";
import { AuthService } from "@/lib/auth/AuthService";
import { AssetService } from "@/lib/services/AssetService";
import { AssetValidator } from "@/lib/validation/AssetValidator";
import { ROLES } from "@/lib/constants";
import type { FormState } from "@/lib/types";

export async function registerAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // 1. Server-side permission check (C1) – runs even if someone calls this directly
  // Only Asset Custodians register assets (Phase 4–5, UC-02)
  await AuthService.requireRole(ROLES.CUSTODIAN);

  // 2. Validate; on error keep what the user typed (FR-09)
  const { input, errors, values } = AssetValidator.fromForm(formData);
  if (!input) {
    return { ok: false, message: "Please correct the highlighted fields.", errors, values };
  }

  // 3. Save through the database function (adds history + audit in one transaction)
  const result = await AssetService.register(input);
  if (result.error) {
    return { ok: false, message: result.error, values };
  }

  // 4. AI 1: save the tags the custodian reviewed (if any), with the AI suggestion for the audit log
  const tags = String(formData.get("tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  if (tags.length && result.assetId) {
    let suggestion: unknown = null;
    try { suggestion = JSON.parse(String(formData.get("ai_suggestion") || "null")); } catch { suggestion = null; }
    const saved = await AssetService.saveTags(result.assetId, tags, suggestion);
    if (saved.error) console.error("AI 1 tags were not saved:", saved.error);
  }

  redirect(`/assets/${result.assetId}?msg=registered`);
}
