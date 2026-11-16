export type SpecificationValue = string | number | boolean;

export type MandatoryRequirement = {
  field: string;
  operator: "eq" | "gte" | "lte";
  value: SpecificationValue;
};

export type MatchingRequest = {
  categoryId: string;
  quantity: number;
  requiredDate: string | null;

  // null = not assessed; [] = explicitly confirmed no mandatory requirements.
  mandatoryRequirements: MandatoryRequirement[] | null;
};

export type MatchingAssetEvidence = {
  categoryId: string;
  isPublished: boolean;
  state: string;
  availableQuantity: number;
  condition: string;

  // These must come from authorized, recorded evidence—not AI guesses.
  safetyStatus: "clear" | "restricted" | "unknown";
  inspectionRequired: boolean | null;
  inspection: {
    result: "passed" | "failed" | "unknown";
    inspectedOn: string;
    validUntil: string;
  } | null;

  // Earliest confirmed receipt date, including transfer feasibility.
  earliestReceiptDate: string | null;
  specifications: Record<string, SpecificationValue | null>;
};

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const parsed = new Date(`${value}T00:00:00Z`);

  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

export function satisfies(
  actual: SpecificationValue | null | undefined,
  requirement: MandatoryRequirement,
) {
  if (actual === null || actual === undefined) return false;

  if (requirement.operator === "eq") {
    if (typeof actual !== typeof requirement.value) return false;

    if (typeof actual === "string" && typeof requirement.value === "string") {
      return (
        actual.trim().toLowerCase() ===
        requirement.value.trim().toLowerCase()
      );
    }

    if (typeof actual === "number") {
      return Number.isFinite(actual) && actual === requirement.value;
    }

    return actual === requirement.value;
  }

  if (
    typeof actual !== "number" ||
    typeof requirement.value !== "number" ||
    !Number.isFinite(actual) ||
    !Number.isFinite(requirement.value)
  ) {
    return false;
  }

  if (requirement.operator === "gte") {
    return actual >= requirement.value;
  }

  if (requirement.operator === "lte") {
    return actual <= requirement.value;
  }

  return false;
}

export function checkEligibility(
  request: MatchingRequest,
  asset: MatchingAssetEvidence,
  today: string,
) {
  const reasons: string[] = [];

  if (!validDate(today)) {
    throw new Error("A valid assessment date is required.");
  }

  if (!request.categoryId || request.categoryId !== asset.categoryId) {
    reasons.push("Category does not match.");
  }

  if (
    !Number.isSafeInteger(request.quantity) ||
    request.quantity < 1
  ) {
    reasons.push("Request quantity is invalid.");
  }

  if (!asset.isPublished || asset.state !== "Available") {
    reasons.push("Asset is not published and available.");
  }

  if (
    !Number.isSafeInteger(asset.availableQuantity) ||
    asset.availableQuantity < request.quantity
  ) {
    reasons.push("Insufficient or invalid available quantity.");
  }

  if (!["Good", "Fair"].includes(asset.condition)) {
    reasons.push("Condition is not approved for reuse.");
  }

  if (asset.safetyStatus !== "clear") {
    reasons.push("Safety clearance is missing or restricted.");
  }

  if (asset.inspectionRequired === null) {
    reasons.push("Inspection requirement has not been assessed.");
  }

  const requiredDateValid =
    request.requiredDate === null || validDate(request.requiredDate);

  if (!requiredDateValid) {
    reasons.push("Required date is invalid.");
  }

  if (request.requiredDate !== null && requiredDateValid) {
    if (
      asset.earliestReceiptDate === null ||
      !validDate(asset.earliestReceiptDate)
    ) {
      reasons.push("Required-date feasibility is not confirmed.");
    } else if (asset.earliestReceiptDate > request.requiredDate) {
      reasons.push("Asset cannot arrive by the required date.");
    }
  }

  // Proposed conservative convention:
  // required inspections must remain valid through the assessment date
  // or the required receipt date, whichever is later.
  const assessmentDate =
    requiredDateValid &&
    request.requiredDate !== null &&
    request.requiredDate > today
      ? request.requiredDate
      : today;

  if (asset.inspectionRequired === true) {
    const inspection = asset.inspection;

    if (
      !inspection ||
      inspection.result !== "passed" ||
      !validDate(inspection.inspectedOn) ||
      !validDate(inspection.validUntil) ||
      inspection.inspectedOn > today ||
      inspection.validUntil < inspection.inspectedOn ||
      inspection.validUntil < assessmentDate
    ) {
      reasons.push("A valid required inspection is missing or failed.");
    }
  }

  if (request.mandatoryRequirements === null) {
    reasons.push("Mandatory specifications have not been confirmed.");
  } else {
    for (const requirement of request.mandatoryRequirements) {
      const field = requirement.field.trim();

      if (
        !field ||
        !Object.hasOwn(asset.specifications, field) ||
        !satisfies(asset.specifications[field], requirement)
      ) {
        reasons.push(
          `Mandatory specification missing or unmet: ${field || "unnamed field"}.`,
        );
      }
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
  };
}
