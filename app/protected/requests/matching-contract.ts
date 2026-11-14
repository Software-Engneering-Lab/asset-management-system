import { checkEligibility, satisfies, type MandatoryRequirement, type MatchingAssetEvidence, type MatchingRequest, type SpecificationValue } from "./eligibility";
import { calculateCompatibility, compareCandidates, type FactorValues } from "./scoring";

export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseRequirements(value: unknown): MandatoryRequirement[] {
  if (!Array.isArray(value) || value.length > 50) throw new Error("Use an array of at most 50 requirements.");
  return value.map((item: unknown) => {
    if (!object(item) || typeof item.field !== "string" || !/^[a-z][a-z0-9_]{0,63}$/.test(item.field) ||
        !["eq", "gte", "lte"].includes(String(item.operator)) ||
        !["string", "number", "boolean"].includes(typeof item.value) ||
        (typeof item.value === "number" && !Number.isFinite(item.value)) ||
        (typeof item.value === "string" && (!item.value.trim() || item.value.length > 1000)) ||
        (item.operator !== "eq" && typeof item.value !== "number")) throw new Error("Invalid requirement. Use field, operator (eq/gte/lte), and a typed value.");
    return { field: item.field, operator: item.operator as MandatoryRequirement["operator"], value: item.value as SpecificationValue };
  });
}

export type Candidate = {
  asset_id: string; name: string; description: string; condition: string;
  available_quantity: number; category_id: string; is_published: boolean; asset_state: string;
  evidence: Record<string, unknown> | null;
  evidence_snapshot: Record<string, unknown>;
};
export type Packet = {
  contract_version: string; request_id: string; specifications: string; purpose: string;
  category_id: string; quantity: number; preferred_condition: string | null;
  required_date: string | null; preferred_location: string | null; request_status: string;
  assessment_date: string; base_total: number; candidate_limit: number;
  mandatory_requirements: unknown; preferred_requirements: unknown; candidates: Candidate[];
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function parsePacket(value: unknown): Packet {
  if (!object(value) || value.contract_version !== "weighted-evidence-v1" ||
      typeof value.request_id !== "string" || !uuid.test(value.request_id) ||
      typeof value.specifications !== "string" || typeof value.purpose !== "string" ||
      typeof value.category_id !== "string" || typeof value.quantity !== "number" ||
      !Number.isSafeInteger(value.quantity) || value.quantity < 1 ||
      typeof value.assessment_date !== "string" || typeof value.request_status !== "string" ||
      typeof value.base_total !== "number" || value.candidate_limit !== 25 ||
      !["string", "object"].includes(typeof value.preferred_condition) ||
      !(value.preferred_condition === null || typeof value.preferred_condition === "string") ||
      !(value.required_date === null || typeof value.required_date === "string") ||
      !(value.preferred_location === null || typeof value.preferred_location === "string") ||
      !Array.isArray(value.candidates) || value.candidates.length > 25) throw new Error("Matching correction migration is missing or returned an invalid contract.");
  const seen = new Set<string>();
  for (const item of value.candidates) {
    if (!object(item) || typeof item.asset_id !== "string" || !uuid.test(item.asset_id) || seen.has(item.asset_id) ||
        typeof item.name !== "string" || typeof item.description !== "string" || typeof item.condition !== "string" ||
        typeof item.category_id !== "string" || typeof item.is_published !== "boolean" || typeof item.asset_state !== "string" ||
        !Number.isSafeInteger(item.available_quantity) || !object(item.evidence_snapshot) ||
        !(item.evidence === null || object(item.evidence))) throw new Error("Invalid matching candidate.");
    seen.add(item.asset_id);
  }
  return value as unknown as Packet;
}

function optionalNumber(evidence: Record<string, unknown>, field: string, source: string, max: number) {
  if (field === "estimatedTransferRepairCost" && evidence.costCurrency !== "AED") return null;
  const value = evidence[field];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max &&
    typeof evidence[source] === "string" && String(evidence[source]).trim()
    ? value : null;
}

export function eligibleCandidates(packet: Packet) {
  let mandatory: MandatoryRequirement[];
  let preferred: MandatoryRequirement[];
  try {
    mandatory = parseRequirements(packet.mandatory_requirements);
    preferred = parseRequirements(packet.preferred_requirements);
  } catch {
    return { eligible: [] as Candidate[], excluded: packet.candidates.map((a) => ({ assetId: a.asset_id, reasons: ["Requester must confirm structured mandatory/preferred specifications."] })), mandatory: null, preferred: [] as MandatoryRequirement[] };
  }
  const request: MatchingRequest = { categoryId: packet.category_id, quantity: packet.quantity, requiredDate: packet.required_date, mandatoryRequirements: mandatory };
  const eligible: Candidate[] = [];
  const excluded: { assetId: string; reasons: string[] }[] = [];
  for (const candidate of packet.candidates) {
    try {
      const e = candidate.evidence;
      if (!e || !object(e.specifications) || ![true, false].includes(e.inspectionRequired as boolean) ||
          !["clear", "restricted", "unknown"].includes(String(e.safetyStatus))) throw new Error("Recorded safety/specification evidence is missing, stale or unverified.");
      for (const value of Object.values(e.specifications)) {
        if (value !== null && !["string", "number", "boolean"].includes(typeof value)) throw new Error("Invalid structured asset specifications.");
      }
      const inspection = e.inspection;
      if (inspection !== null && inspection !== undefined && (!object(inspection) ||
          !["passed", "failed", "unknown"].includes(String(inspection.result)) || typeof inspection.inspectedOn !== "string" || typeof inspection.validUntil !== "string")) throw new Error("Invalid inspection evidence.");
      if (!(e.earliestReceiptDate === null || typeof e.earliestReceiptDate === "string")) throw new Error("Receipt-date evidence must be recorded or explicitly unknown.");
      const facts: MatchingAssetEvidence = {
        categoryId: candidate.category_id, isPublished: candidate.is_published, state: candidate.asset_state,
        availableQuantity: candidate.available_quantity, condition: candidate.condition,
        safetyStatus: e.safetyStatus as MatchingAssetEvidence["safetyStatus"], inspectionRequired: e.inspectionRequired as boolean,
        inspection: (inspection ?? null) as MatchingAssetEvidence["inspection"], earliestReceiptDate: e.earliestReceiptDate as string | null,
        specifications: e.specifications as MatchingAssetEvidence["specifications"],
      };
      const result = checkEligibility(request, facts, packet.assessment_date);
      if (result.eligible) eligible.push(candidate); else excluded.push({ assetId: candidate.asset_id, reasons: result.reasons });
    } catch (error) { excluded.push({ assetId: candidate.asset_id, reasons: error instanceof Error ? [error.message] : ["Invalid evidence."] }); }
  }
  return { eligible, excluded, mandatory, preferred };
}

export type SemanticAssessment = { asset_id: string; similarity: number; explanation: string };
export function assembleWeightedMatches(packet: Packet, assessments: SemanticAssessment[]) {
  const checked = eligibleCandidates(packet);
  if (checked.mandatory === null) throw new Error("Structured requirements have not been confirmed.");
  const eligible = checked.eligible;
  if (assessments.length !== eligible.length || new Set(assessments.map((x) => x.asset_id)).size !== eligible.length) throw new Error("Semantic evidence must cover each eligible shortlisted asset exactly once.");
  const costs = eligible.map((c) => optionalNumber(c.evidence!, "estimatedTransferRepairCost", "costEvidence", Number.MAX_SAFE_INTEGER)).filter((x): x is number => x !== null);
  const minCost = Math.min(...costs), maxCost = Math.max(...costs);
  const scored = eligible.map((candidate) => {
    const semantic = assessments.find((a) => a.asset_id === candidate.asset_id);
    if (!semantic || !Number.isFinite(semantic.similarity) || semantic.similarity < 0 || semantic.similarity > 1 || !semantic.explanation.trim() || semantic.explanation.length > 240) throw new Error("Invalid semantic evidence.");
    const evidence = candidate.evidence!;
    const specs = evidence.specifications as Record<string, SpecificationValue | null>;
    const allRequirements = [...checked.mandatory!, ...checked.preferred];
    const supportedPreferences = checked.preferred.filter((r) => Object.hasOwn(specs, r.field) && specs[r.field] !== null);
    // If any optional specification evidence is missing, omit this factor,
    // rather than penalizing the missing values as failures.
    const specificationScore = supportedPreferences.length !== checked.preferred.length || allRequirements.length === 0
      ? null : allRequirements.filter((r) => satisfies(specs[r.field], r)).length / allRequirements.length;
    const cost = optionalNumber(evidence, "estimatedTransferRepairCost", "costEvidence", Number.MAX_SAFE_INTEGER);
    const factors: FactorValues = {
      specifications: specificationScore,
      purposeSimilarity: semantic.similarity,
      condition: !["Good", "Fair", "Poor"].includes(packet.preferred_condition ?? "") ? null :
        packet.preferred_condition === "Good" ? (candidate.condition === "Good" ? 1 : 0.5) : 1,
      dateUrgency: packet.required_date === null ? null : 1,
      locationEffort: optionalNumber(evidence, "locationEffortScore", "locationEvidence", 1),
      financialEffect: cost === null ? null : maxCost === minCost ? 1 : (maxCost - cost) / (maxCost - minCost),
      environmentalEffect: optionalNumber(evidence, "environmentalEffectScore", "environmentalEvidence", 1),
    };
    const score = calculateCompatibility({ assetId: candidate.asset_id, factors, aiConfidence: null, estimatedTransferRepairCost: cost });
    if (semantic.similarity < 0.7) score.warnings.push("Weak semantic match: similarity is below 0.70.");
    return { candidate, semantic, score, factors };
  }).sort((a, b) => compareCandidates(a.score, b.score));
  return scored.slice(0, 5).map(({ candidate, semantic, score, factors }) => ({
    asset_id: candidate.asset_id, compatibility_score: score.compatibilityScore, confidence: null,
    explanation: semantic.explanation.replace(/\s+/g, " ").trim(), factor_values: factors,
    evidence_coverage: score.evidenceCoverage, warnings: score.warnings,
    scoring_version: score.scoringVersion, estimated_transfer_repair_cost: score.estimatedTransferRepairCost,
    evidence_snapshot: candidate.evidence_snapshot,
  }));
}
