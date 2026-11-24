// These names match the JSON returned by renad_approval_workspace().
export type ApprovalRequest = {
  request_id: string;
  submitted_by: string;
  requester: string;
  department: string;
  category: string;
  specifications: string;
  purpose: string;
  quantity: number;
  preferred_condition: string | null;
  urgency: string;
  request_status: string;
  created_at: string;
  latest_approval: { asset_id: string | null; reason: string; approved_quantity: number | null } | null;
  reservation: { reservation_id: string; expires_at: string; reserved_quantity: number } | null;
  assets: { asset_id: string; name: string; condition: string; available_quantity: number }[];
  accepted_matches: { asset_id: string; score: number; explanation: string; created_at: string }[];
  history: { to_status: string; changed_at: string; actor: string; reason: string | null }[];
};
export type ApprovalFormState = { ok: boolean; message: string };
