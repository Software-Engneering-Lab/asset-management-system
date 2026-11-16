// Phase 4–5, section 8.11.
// Inputs are evidence-backed normalized values from 0 to 1.
// null means optional evidence is unavailable—not a zero score.

export const FACTOR_WEIGHTS = {
  specifications: 35,
  purposeSimilarity: 25,
  condition: 10,
  dateUrgency: 10,
  locationEffort: 10,
  financialEffect: 5,
  environmentalEffect: 5,
} as const;

export type FactorName = keyof typeof FACTOR_WEIGHTS;

export type FactorValues = Record<FactorName, number | null>;

type ScoringInput = {
  assetId: string;
  factors: FactorValues;
  aiConfidence: number | null;
  estimatedTransferRepairCost: number | null;
};

export function calculateCompatibility(input: ScoringInput) {
  let availableWeight = 0;
  let weightedSum = 0;
  const missingFactors: FactorName[] = [];

  const factors = Object.entries(FACTOR_WEIGHTS).map(
    ([name, weight]) => {
      const key = name as FactorName;
      const value = input.factors[key];

      if (value === null) {
        missingFactors.push(key);
        return { name: key, weight, value: null, contribution: null };
      }

      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 1
      ) {
        throw new Error(`Invalid normalized value for ${key}.`);
      }

      availableWeight += weight;
      weightedSum += weight * value;

      return {
        name: key,
        weight,
        value,
        contribution: weight * value,
      };
    },
  );

  if (availableWeight === 0) {
    throw new Error("Cannot score an asset without evidence.");
  }

  const confidence = input.aiConfidence;

  if (
    confidence !== null &&
    (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)
  ) {
    throw new Error("Invalid confidence value.");
  }

  const cost = input.estimatedTransferRepairCost;

  if (
    cost !== null &&
    (!Number.isFinite(cost) || cost < 0)
  ) {
    throw new Error("Invalid estimated transfer/repair cost.");
  }

  const compatibilityScore =
    Math.round((100 * weightedSum / availableWeight) * 100) / 100;

  // All seven documented weights sum to 100.
  const evidenceCoverage = availableWeight;

  const warnings: string[] = [];

  if (compatibilityScore < 70) {
    warnings.push("Weak recommendation: compatibility is below 70/100.");
  }

  if (evidenceCoverage < 80) {
    warnings.push("Incomplete evidence: coverage is below 80%.");
  }

  if (confidence === null) {
    warnings.push("AI confidence not supplied; no top-pick claim.");
  } else if (confidence < 0.7) {
    warnings.push("Low AI confidence: below 70%.");
  }

  return {
    assetId: input.assetId,
    scoringVersion: "phase45-weighted-v1",
    compatibilityScore,
    evidenceCoverage,
    aiConfidence: confidence,
    estimatedTransferRepairCost: cost,
    missingFactors,
    factors,
    warnings,
    topPickEligible:
      compatibilityScore >= 70 &&
      evidenceCoverage >= 80 &&
      confidence !== null &&
      confidence >= 0.7,
  };
}

export type ScoredCandidate = ReturnType<typeof calculateCompatibility>;

export function compareCandidates(
  first: ScoredCandidate,
  second: ScoredCandidate,
) {
  if (first.compatibilityScore !== second.compatibilityScore) {
    return second.compatibilityScore - first.compatibilityScore;
  }

  // Implementation convention: known costs precede unknown costs.
  const firstCost = first.estimatedTransferRepairCost;
  const secondCost = second.estimatedTransferRepairCost;

  if (firstCost !== null && secondCost === null) return -1;
  if (firstCost === null && secondCost !== null) return 1;

  if (
    firstCost !== null &&
    secondCost !== null &&
    firstCost !== secondCost
  ) {
    return firstCost - secondCost;
  }

  return first.assetId < second.assetId
    ? -1
    : first.assetId > second.assetId
      ? 1
      : 0;
}