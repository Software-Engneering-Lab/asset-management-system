"use server";

import { createClient } from "@/lib/supabase/server";
import { createMatchingWriter } from "./matching-db";
import { rankEligibleAssets } from "./rank-assets";
import { eligibleCandidates, parsePacket, parseRequirements } from "./matching-contract";

export type SavedMatch = {
  recommendation_id: string; asset_id: string; name: string; condition: string;
  available_quantity: number; rank_position: number; compatibility_score: number;
  confidence: number | null; explanation: string; review_status: "pending" | "accepted" | "rejected";
  review_reason: string | null; created_at: string;
  scoring_version: string | null; evidence_coverage: number | null;
  factor_values: Record<string, number | null> | null;
  factor_contributions: Record<string, number | null> | null;
  warnings: string[]; currently_eligible: boolean;
};
export type FallbackAsset = { asset_id: string; name: string; condition: string };
type MatchResult = { success: true; matches: SavedMatch[]; message: string } |
  { success: false; message: string; fallback?: FallbackAsset[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function databaseMessage(code: string) {
  if (["PGRST202", "42703", "42P01"].includes(code)) return "Matching correction is not enabled yet. The reviewed corrective migration must be applied.";
  if (code === "42501") return "Access denied. An active requester profile and ownership of this request are required.";
  if (code === "22023") return "The request/evidence/availability changed or the input is invalid. Refresh before retrying.";
  if (code === "P0001") return "Please wait at least 15 seconds between matching attempts.";
  return "Database operation failed. Refresh before retrying.";
}

export async function confirmMatchingRequirements(requestId: string, mandatoryText: string, preferredText: string) {
  try {
    if (!uuid.test(requestId) || typeof mandatoryText !== "string" || typeof preferredText !== "string" || mandatoryText.length > 20000 || preferredText.length > 20000) throw new Error("Invalid requirements.");
    const mandatory = parseRequirements(JSON.parse(mandatoryText));
    const preferred = parseRequirements(JSON.parse(preferredText));
    const db = await createClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return { success: false, message: "Please sign in." };
    const { error } = await db.rpc("shaikha_confirm_matching_requirements", { p_request_id: requestId, p_mandatory: mandatory, p_preferred: preferred });
    if (error) return { success: false, message: databaseMessage(error.code) };
    return { success: true, message: "Structured requirements confirmed. Previous rankings may be stale; generate a new run." };
  } catch { return { success: false, message: "Use JSON arrays of field, operator (eq/gte/lte), and typed value. Use [] only if none apply." }; }
}

export async function loadMatches(requestId: string): Promise<MatchResult> {
  if (!uuid.test(requestId)) return { success: false, message: "Invalid request reference." };
  try {
    const db = await createClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return { success: false, message: "Please sign in." };
    const { data, error } = await db.rpc("shaikha_read_matches", { p_request_id: requestId, p_ranking_run_id: null });
    if (error) return { success: false, message: databaseMessage(error.code) };
    if (!data || data.contract_version !== "weighted-evidence-v1" || !Array.isArray(data.matches)) return { success: false, message: "Corrective matching migration is not installed." };
    return { success: true, matches: data.matches as SavedMatch[], message: data.matches.length ? "Latest saved weighted run. Stale recommendations cannot be accepted." : "No corrected saved recommendations. Legacy AI-invented scores are not shown." };
  } catch { return { success: false, message: "Unable to load saved matches." }; }
}

export async function generateMatches(requestId: string): Promise<MatchResult> {
  if (!uuid.test(requestId)) return { success: false, message: "Invalid request reference." };
  try {
    const db = await createClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return { success: false, message: "Please sign in." };
    const { data: raw, error } = await db.rpc("shaikha_matching_candidates", { p_request_id: requestId });
    if (error) return { success: false, message: databaseMessage(error.code) };
    const packet = parsePacket(raw);
    if (packet.request_id !== requestId) throw new Error("Mismatched request.");
    const checked = eligibleCandidates(packet);
    if (checked.mandatory === null) return { success: false, message: "Confirm structured mandatory/preferred requirements below before ranking. Free text is not treated as verified requirements." };
    if (!checked.eligible.length) return { success: true, matches: [], message: `No verified eligible assets in the ${packet.candidates.length}-asset shortlist (${packet.base_total} basic candidates total). ${checked.excluded.length} excluded for missing, stale or failing evidence. No AI call was made. Available/Good alone does not establish safety.` };
    const fallback = checked.eligible.slice(0, 5).map((c) => ({ asset_id: c.asset_id, name: c.name, condition: c.condition }));
    if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) return { success: false, message: "AI is unconfigured. These are verified unranked rule-based results, without scores.", fallback };
    const writer = createMatchingWriter();
    let ranking: Awaited<ReturnType<typeof rankEligibleAssets>>;
    try { ranking = await rankEligibleAssets(packet); }
    catch { return { success: false, message: "AI unavailable, timed out or invalid semantic evidence. These are unranked rule-based results, not AI scores.", fallback }; }
    const runId = crypto.randomUUID();
    const { error: saveError } = await writer.rpc("shaikha_save_weighted_matches", {
      p_actor_id: auth.user.id, p_request_id: requestId, p_ranking_run_id: runId,
      p_model_name: process.env.GEMINI_MODEL, p_model_version: ranking.modelVersion,
      p_packet: packet, p_matches: ranking.matches,
    });
    if (saveError) return { success: false, message: databaseMessage(saveError.code) };
    const { data: saved, error: readError } = await db.rpc("shaikha_read_matches", { p_request_id: requestId, p_ranking_run_id: runId });
    if (readError || !saved || !Array.isArray(saved.matches)) return { success: false, message: "Run saved but display unconfirmed. Load saved matches before retrying." };
    return { success: true, matches: saved.matches as SavedMatch[], message: `Saved ${saved.matches.length} weighted recommendations from ${checked.eligible.length} verified eligible shortlisted assets; ${packet.base_total} basic candidates total. Missing confidence is warned; no top-pick claim.` };
  } catch { return { success: false, message: "Matching setup or evidence unavailable. Check the corrective migration and server configuration. Unverified assets will not be ranked." }; }
}

export async function reviewMatch(recommendationId: string, decision: "accepted" | "rejected", reason: string) {
  if (!uuid.test(recommendationId) || !["accepted", "rejected"].includes(decision) || typeof reason !== "string" || reason.trim().length > 1000 || (decision === "rejected" && !reason.trim())) return { success: false, message: "Valid decision required; rejection needs a reason." };
  try {
    const db = await createClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return { success: false, message: "Please sign in." };
    const { error } = await db.rpc("shaikha_review_match", { p_recommendation_id: recommendationId, p_decision: decision, p_reason: reason.trim() || null });
    return error ? { success: false, message: databaseMessage(error.code) } : { success: true, message: `Recommendation ${decision}. No approval, reservation or ownership change occurred.` };
  } catch { return { success: false, message: "Review unconfirmed. Reload saved results." }; }
}
