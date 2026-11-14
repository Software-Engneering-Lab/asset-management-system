"use client";

import { useRef, useState } from "react";
import {
  generateMatches,
  loadMatches,
  reviewMatch,
  type SavedMatch,
  type FallbackAsset,
} from "./matching-actions";

export default function MatchingPanel({
  requestId,
  requestStatus,
}: {
  requestId: string;
  requestStatus: string;
}) {
  const [matches, setMatches] = useState<SavedMatch[]>([]);
  const [fallback, setFallback] = useState<FallbackAsset[]>([]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const running = useRef(false);

  const canReview = ["Submitted", "Under Review"].includes(requestStatus);

  async function handleLoad(generate: boolean) {
    if (running.current) return;

    running.current = true;
    setBusy(true);
    setMessage("");
    setError("");
    setMatches([]);
    setFallback([]);

    try {
      const result = generate
        ? await generateMatches(requestId)
        : await loadMatches(requestId);

      if (result.success) {
        setMatches(result.matches);
        setMessage(result.message);
      } else {
        setError(result.message);
        setFallback(result.fallback ?? []);
      }
    } catch {
      setError("Unable to complete matching. Please try loading saved matches.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function handleReview(
    match: SavedMatch,
    decision: "accepted" | "rejected",
  ) {
    if (running.current) return;

    const reason = reasons[match.recommendation_id] ?? "";

    if (decision === "rejected" && !reason.trim()) {
      setError("Enter a reason before rejecting this recommendation.");
      return;
    }

    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await reviewMatch(
        match.recommendation_id,
        decision,
        reason,
      );

      if (result.success) {
        setMatches((previous) =>
          previous.map((item) =>
            item.recommendation_id === match.recommendation_id
              ? {
                  ...item,
                  review_status: decision,
                  review_reason: reason.trim() || null,
                }
              : item,
          ),
        );
        setMessage(result.message);
      } else {
        setError(result.message);
      }
    } catch {
      setError("Decision could not be confirmed. Load saved matches to check.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="mt-5 space-y-4 border-t pt-4">
      <h4 className="font-semibold">Asset matching</h4>

      <p className="text-sm text-muted-foreground">
        Up to five AI recommendations from a shortlist of at most 25 eligible
        assets. Scores estimate suitability, not confidence. Acceptance does
        not approve a request or reserve stock.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleLoad(false)}
          disabled={busy}
          className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
        >
          Load saved matches
        </button>

        {canReview && (
          <button
            type="button"
            onClick={() => void handleLoad(true)}
            disabled={busy}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            Generate matches
          </button>
        )}
      </div>

      <p role="status" className="text-sm">
        {busy ? "Working—please wait…" : message}
      </p>

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      {fallback.length > 0 && (
        <div className="rounded-md border p-3">
          <h5 className="font-medium">Unranked fallback results</h5>
          <p className="mt-1 text-sm">
            No AI scores or review decisions are available for these results.
          </p>
          <ul className="mt-2 space-y-2">
            {fallback.map((asset) => (
              <li key={asset.asset_id} className="text-sm">
                {asset.name} — {asset.condition}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ol className="space-y-3">
        {matches.map((match) => (
          <li
            key={match.recommendation_id}
            className="rounded-md border p-4"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <h5 className="font-semibold">
                {match.rank_position}. {match.name}
              </h5>
              <span className="text-sm">
                Score: {Number(match.compatibility_score).toFixed(0)}/100
              </span>
            </div>

            <p className="mt-2 text-sm">{match.explanation}</p>

            <p className="mt-2 text-xs text-muted-foreground">
              Condition: {match.condition} · Current available quantity:{" "}
              {match.available_quantity}
            </p>

            <p className="mt-1 text-xs text-muted-foreground">
              Confidence:{" "}
              {match.confidence === null
                ? "Not available"
                : `${Math.round(match.confidence * 100)}%`}
            </p>

            <p className="mt-2 text-sm">
              Your decision: <strong>{match.review_status}</strong>
            </p>

            {match.review_reason && (
              <p className="mt-1 whitespace-pre-wrap text-sm">
                Reason: {match.review_reason}
              </p>
            )}

            {canReview && match.review_status === "pending" && (
              <div className="mt-3 space-y-2">
                <label className="block text-sm">
                  Review reason—required for rejection
                  <textarea
                    value={reasons[match.recommendation_id] ?? ""}
                    onChange={(event) =>
                      setReasons((previous) => ({
                        ...previous,
                        [match.recommendation_id]: event.target.value,
                      }))
                    }
                    maxLength={1000}
                    disabled={busy}
                    rows={2}
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                  />
                </label>

                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleReview(match, "accepted")}
                    className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                  >
                    Accept
                  </button>

                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleReview(match, "rejected")}
                    className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}