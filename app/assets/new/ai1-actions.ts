"use server";

import { AuthService } from "@/lib/auth/AuthService";
import { AssetService } from "@/lib/services/AssetService";
import { AssetClassifier, type ClassificationSuggestion } from "@/lib/ai/AssetClassifier";
import { ROLES } from "@/lib/constants";

export type SuggestResult =
  | { ok: true; suggestion: ClassificationSuggestion & { categoryId: string | null } }
  | { ok: false; message: string };

/** AI 1: suggest category, condition and tags. Saves nothing; the custodian reviews the result. */
export async function suggestClassificationAction(name: string, description: string): Promise<SuggestResult> {
  await AuthService.requireRole(ROLES.CUSTODIAN);
  const cleanName = String(name ?? "").trim();
  const cleanDescription = String(description ?? "").trim();
  if (cleanName.length < 2 && cleanDescription.length < 5) {
    return { ok: false, message: "Type the asset name and description first, then ask for suggestions." };
  }
  const categories = await AssetService.listCategories();
  const suggestion = await AssetClassifier.suggest(cleanName, cleanDescription, categories.map((c) => c.name));
  const categoryId = categories.find((c) => c.name === suggestion.categoryName)?.category_id ?? null;
  return { ok: true, suggestion: { ...suggestion, categoryId } };
}
