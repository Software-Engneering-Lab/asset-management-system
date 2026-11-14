"use server";

import { redirect } from "next/navigation";
import { AuthService } from "@/lib/auth/AuthService";
import { AssetService } from "@/lib/services/AssetService";
import { AssetValidator } from "@/lib/validation/AssetValidator";
import { ROLES } from "@/lib/constants";
import type { FormState } from "@/lib/types";

export async function registerAssetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  // 1. Server-side permission check (C1) – runs even if someone calls this directly
  await AuthService.requireRole(ROLES.CUSTODIAN, ROLES.ADMIN);

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

  redirect(`/assets/${result.assetId}?msg=registered`);
}
