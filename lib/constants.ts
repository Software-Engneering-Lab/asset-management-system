// Shared names – they match supabase/migrations/20261113000100_foundation_contract.sql.
// If the team changes a name, change it HERE only.

export const ROLES = {
  REQUESTER: "requester",
  CUSTODIAN: "custodian",
  APPROVER: "approver",
  ADMIN: "admin",
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

// Asset states (asset_state_allowed constraint, Phase 3 SRS Section 3.3)
export const ASSET_STATES = {
  DRAFT: "Draft",
  REGISTERED: "Registered",
  AVAILABLE: "Available",
  RESERVED: "Reserved",
  IN_TRANSFER: "In Transfer",
  UNDER_INSPECTION: "Under Inspection",
  UNDER_MAINTENANCE: "Under Maintenance",
  UNAVAILABLE: "Unavailable",
  UNREPAIRABLE: "Unrepairable",
  DONATED: "Donated",
  RECYCLED: "Recycled",
  RETIRED: "Retired",
  DISPOSED: "Disposed",
  CANCELLED: "Cancelled",
} as const;

// Shared UI convention from docs/TEAM_DATABASE_START.md
export const CONDITIONS = ["Good", "Fair", "Poor"] as const;
export type AssetCondition = (typeof CONDITIONS)[number];

// Only these conditions may be published for reuse (FR-10, NFR-SA01)
export const PUBLISHABLE_CONDITIONS: readonly string[] = ["Good", "Fair"];
