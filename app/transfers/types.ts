// These types describe the permission-scoped JSON returned by the workspace function.
export type FormState = { ok: boolean; message: string };
export type Rule = { field: string; operator: string; value: string | number | boolean };
export type Person = { user_id: string; name: string; department_id: string; roles: string[] };
export type Hold = { reservation_id: string; request_id: string; asset_name: string; quantity: number; expires_at: string; receiving_department: string };
export type EligibilityCheck = {
  request_id: string; specifications: string; quantity: number; status: string; required_date: string | null;
  can_confirm: boolean; mandatory: Rule[]; preferred: Rule[];
  assets: { asset_id: string; name: string; description: string; location: string; condition: string; problem: string | null }[];
};
export type Transfer = {
  transfer_id: string; request_id: string; asset_name: string; quantity: number; transfer_status: string;
  sending_department: string; receiving_department: string; receiving_department_id: string;
  expected_receiver_id: string | null; receiving_custodian_id: string | null;
  receiver: string | null; custodian: string | null; expires_at: string;
  collection_date: string | null; destination_location: string | null; origin_location: string | null;
  arrangement_notes: string | null; transfer_cost: number | null; document_reference: string | null;
  released_condition: string | null; received_asset_id: string | null;
  can_send: boolean; can_receive: boolean; can_approve: boolean;
  discrepancies: { discrepancy_id: string; description: string; reporter: string; reported_at: string;
    resolution: string | null; resolver: string | null; resolved_at: string | null }[];
  history: { action: string; at: string; actor: string; reason: string | null }[];
};
export type Workspace = { transfers: Transfer[]; holds: Hold[]; checks: EligibilityCheck[]; people: Person[] };
