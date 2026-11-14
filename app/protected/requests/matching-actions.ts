"use server";

import { createClient } from "@/lib/supabase/server";
import { createMatchingWriter } from "./matching-db";
import {
  rankEligibleAssets,
  type EligibleCandidate,
} from "./rank-assets";

export type SavedMatch = {
  recommendation_id: string;
  asset_id: string;
  name: string;
  condition: string;
  available_quantity: number;
  rank_position: number;
  compatibility_score: number;
  confidence: number | null;
  explanation: string;
  review_status: "pending" | "accepted" | "rejected";
  review_reason: string | null;
  created_at: string;
};

export type FallbackAsset = {
  asset_id: string;
  name: string;
  condition: string;
};

type MatchResult =
  | {
      success: true;
      matches: SavedMatch[];
      message: string;
    }
  | {
      success: false;
      message: string;
      fallback?: FallbackAsset[];
    };

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function databaseMessage(code: string) {
  if (code === "PGRST202") {
    return "Matching is not enabled yet. The reviewed matching migrations must be applied.";
  }

  if (code === "42501") {
    return "Access denied. Check your active profile, requester role and request ownership.";
  }

  if (code === "22023") {
    return "The request or asset availability changed, or the decision is invalid. Refresh and try again.";
  }

  return "The database operation failed. Refresh before trying again.";
}

export async function loadMatches(requestId: string): Promise<MatchResult> {
  if (!uuidPattern.test(requestId)) {
    return { success: false, message: "Invalid request reference." };
  }

  try {
    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();

    if (authError || !auth.user) {
      return { success: false, message: "Please sign in." };
    }

    const { data, error } = await supabase.rpc("shaikha_read_matches", {
      p_request_id: requestId,
      p_ranking_run_id: null,
    });

    if (error) {
      return { success: false, message: databaseMessage(error.code) };
    }

    if (!data || !Array.isArray(data.matches)) {
      return { success: false, message: "Unexpected matching response." };
    }

    return {
      success: true,
      matches: data.matches as SavedMatch[],
      message:
        data.matches.length > 0
          ? "Showing the latest saved ranking. Availability may have changed."
          : "No saved recommendations. Select Generate matches.",
    };
  } catch {
    return { success: false, message: "Unable to load saved matches." };
  }
}

export async function generateMatches(
  requestId: string,
): Promise<MatchResult> {
  if (!uuidPattern.test(requestId)) {
    return { success: false, message: "Invalid request reference." };
  }

  try {
    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();

    if (authError || !auth.user) {
      return { success: false, message: "Please sign in." };
    }

    // Check server configuration before consuming AI quota.
    if (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL) {
      return {
        success: false,
        message: "Gemini is not configured on the server.",
      };
    }

    const writer = createMatchingWriter();

    // This user-scoped operation checks ownership and requester permission.
    const { data: raw, error: candidateError } = await supabase.rpc(
      "shaikha_matching_candidates",
      { p_request_id: requestId },
    );

    if (candidateError) {
      return {
        success: false,
        message: databaseMessage(candidateError.code),
      };
    }

    if (
      !object(raw) ||
      raw.request_id !== requestId ||
      typeof raw.specifications !== "string" ||
      typeof raw.eligible_total !== "number" ||
      !Array.isArray(raw.candidates) ||
      raw.candidates.length > 25
    ) {
      return { success: false, message: "Unexpected candidate response." };
    }

    const candidates: EligibleCandidate[] = [];

    for (const item of raw.candidates) {
      if (
        !object(item) ||
        typeof item.asset_id !== "string" ||
        !uuidPattern.test(item.asset_id) ||
        typeof item.name !== "string" ||
        typeof item.description !== "string" ||
        typeof item.condition !== "string"
      ) {
        return { success: false, message: "Invalid asset data." };
      }

      candidates.push({
        asset_id: item.asset_id,
        name: item.name,
        description: item.description,
        condition: item.condition,
      });
    }

    if (candidates.length === 0) {
      return {
        success: true,
        matches: [],
        message: "No currently eligible assets. No AI request was made.",
      };
    }

    let ranking: Awaited<ReturnType<typeof rankEligibleAssets>>;

    try {
      ranking = await rankEligibleAssets(raw.specifications, candidates);
    } catch {
      return {
        success: false,
        message:
          "AI ranking is unavailable, timed out or returned invalid results. Below are unranked eligible assets—not AI recommendations.",
        fallback: candidates.slice(0, 5).map((candidate) => ({
          asset_id: candidate.asset_id,
          name: candidate.name,
          condition: candidate.condition,
        })),
      };
    }

    if (ranking.matches.length === 0) {
      return {
        success: true,
        matches: [],
        message:
          "AI found no relevant matches in the eligible shortlist. No new ranking was saved; older saved results remain in history.",
      };
    }

    const runId = crypto.randomUUID();

    // Identity comes from the verified session, never a browser parameter.
    // Only the restricted server writer can save AI-generated scores.
    const { error: saveError } = await writer.rpc("shaikha_save_matches", {
      p_actor_id: auth.user.id,
      p_request_id: requestId,
      p_ranking_run_id: runId,
      p_model_name: process.env.GEMINI_MODEL,
      p_model_version: ranking.modelVersion,
      p_specifications_snapshot: raw.specifications,
      p_matches: ranking.matches,
    });

    if (saveError) {
      return {
        success: false,
        message: databaseMessage(saveError.code),
      };
    }

    const { data: saved, error: readError } = await supabase.rpc(
      "shaikha_read_matches",
      {
        p_request_id: requestId,
        p_ranking_run_id: runId,
      },
    );

    if (readError || !saved || !Array.isArray(saved.matches)) {
      return {
        success: false,
        message:
          "Ranking was saved, but could not be displayed. Use Load saved matches before generating again.",
      };
    }

    return {
      success: true,
      matches: saved.matches as SavedMatch[],
      message: `Saved ${saved.matches.length} AI recommendations from ${candidates.length} shortlisted candidates (${raw.eligible_total} eligible in total).`,
    };
  } catch {
    return {
      success: false,
      message:
        "Matching could not be completed. Check server configuration and use Load saved matches before retrying.",
    };
  }
}

export async function reviewMatch(
  recommendationId: string,
  decision: "accepted" | "rejected",
  reason: string,
): Promise<{ success: boolean; message: string }> {
  if (
    !uuidPattern.test(recommendationId) ||
    !["accepted", "rejected"].includes(decision) ||
    typeof reason !== "string" ||
    reason.trim().length > 1000 ||
    (decision === "rejected" && !reason.trim())
  ) {
    return {
      success: false,
      message: "Provide a valid decision and a reason when rejecting.",
    };
  }

  try {
    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();

    if (authError || !auth.user) {
      return { success: false, message: "Please sign in." };
    }

    const { error } = await supabase.rpc("shaikha_review_match", {
      p_recommendation_id: recommendationId,
      p_decision: decision,
      p_reason: reason.trim() || null,
    });

    if (error) {
      return { success: false, message: databaseMessage(error.code) };
    }

    return {
      success: true,
      message: `Recommendation ${decision}. This does not approve or reserve an asset.`,
    };
  } catch {
    return {
      success: false,
      message: "Unable to confirm the decision. Load saved matches to check.",
    };
  }
}