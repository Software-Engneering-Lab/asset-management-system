import type { MandatoryRequirement, MatchingAssetEvidence } from "./eligibility";

export const MATCHING_CONTRACT = "weighted-reusable-v2";
export const EVIDENCE_SOURCE = "renad_reusable_asset_evidence";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Keep this small alias map aligned with the shared provider/typed submission.
// Do not infer item type from an asset name, category, description or AI output.
export function canonicalItemType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 1000) return null;
  return normalized === "screen" ? "monitor" : normalized;
}

export function mandatoryItemType(requirements: MandatoryRequirement[]): string {
  const clauses = requirements.filter((rule) => rule.field === "item_type");
  const type = clauses.length === 1 && clauses[0].operator === "eq"
    ? canonicalItemType(clauses[0].value) : null;
  if (type === null) throw new Error("Exactly one mandatory item_type equality rule is required.");
  return type;
}

// Strict adapter for Renad's five-field contract. Unknown top-level fields,
// including legacy optional score/cost inputs, are intentionally not trusted.
// Null/invalid facts stay ineligible; there is NO request-pair evidence fallback.
export function reusableEvidence(value: unknown): Record<string, unknown> | null {
  if (!record(value) || !record(value.specifications) || typeof value.safetyStatus !== "string" ||
      !["clear", "restricted", "unknown"].includes(value.safetyStatus) ||
      typeof value.inspectionRequired !== "boolean" ||
      !(value.earliestReceiptDate === null || typeof value.earliestReceiptDate === "string")) return null;
  const specifications: MatchingAssetEvidence["specifications"] = {};
  for (const [field, actual] of Object.entries(value.specifications)) {
    if (actual !== null && typeof actual !== "string" && typeof actual !== "boolean" &&
        !(typeof actual === "number" && Number.isFinite(actual))) return null;
    specifications[field] = actual as string | number | boolean | null;
  }
  if (Object.hasOwn(specifications, "item_type")) {
    const type = canonicalItemType(specifications.item_type);
    if (type === null) return null;
    specifications.item_type = type;
  }
  const inspection = value.inspection;
  if (inspection !== null && (!record(inspection) || typeof inspection.result !== "string" ||
      !["passed", "failed", "unknown"].includes(inspection.result) ||
      typeof inspection.inspectedOn !== "string" || typeof inspection.validUntil !== "string")) return null;
  return { specifications, safetyStatus: value.safetyStatus, inspectionRequired: value.inspectionRequired,
    inspection: inspection === null ? null : { result: inspection.result,
      inspectedOn: inspection.inspectedOn, validUntil: inspection.validUntil },
    earliestReceiptDate: value.earliestReceiptDate };
}
