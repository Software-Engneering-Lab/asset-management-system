"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthService } from "@/lib/auth/AuthService";
import { AssetService } from "@/lib/services/AssetService";
import { ROLES } from "@/lib/constants";

export async function publishAssetAction(formData: FormData): Promise<void> {
  await AuthService.requireRole(ROLES.CUSTODIAN, ROLES.ADMIN);
  const assetId = String(formData.get("asset_id") ?? "");

  const result = await AssetService.publish(assetId);
  revalidatePath(`/assets/${assetId}`);

  if (result.error) {
    redirect(`/assets/${assetId}?error=${encodeURIComponent(result.error)}`);
  }
  redirect(`/assets/${assetId}?msg=published`);
}
