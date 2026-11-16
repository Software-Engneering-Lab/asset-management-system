"use client";

import { useRef, useState } from "react";
import {
  generateMatches,
  loadMatches,
  reviewMatch,
  confirmMatchingRequirements,
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
  const [mandatoryText, setMandatoryText] = useState("");
  const [preferredText, setPreferredText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const running = useRef(false);

  const canReview = ["Submitted", "Under Review"].includes(requestStatus);

  async function handleRequirements() {
    if (running.current || !confirmed) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await confirmMatchingRequirements(requestId, mandatoryText, preferredText);
      if (result.success) {
        setMatches([]);
        setFallback([]);
        setMessage(result.message);
      } else setError(result.message);
    } catch { setError("Requirements could not be confirmed. Please retry."); }
    finally { running.current = false; setBusy(false); }
  }

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
        Up to five weighted recommendations from a shortlist of at most 25 basic
        candidates, after verified eligibility checks. AI supplies purpose similarity,
        not the overall score. Scores estimate suitability, not confidence. Acceptance does
        not approve a request or reserve stock.
      </p>

      {canReview && <details className="rounded-md border p-3">
        <summary className="cursor-pointer font-medium">Confirm structured specifications before matching</summary>
        <p className="mt-2 text-sm">Record all mandatory conditions from your request as typed JSON clauses.
          Fields and units must match verified asset evidence. For example: <code>{'[{"field":"ram_gb","operator":"gte","value":16}]'}</code>.
          Use <code>[]</code> only when you explicitly have no requirements in that group.
          Unconfirmed requirements or unverified safety, inspection or date evidence block matching.</p>
        <label className="mt-3 block text-sm">Mandatory specifications
          <textarea value={mandatoryText} onChange={(e) => setMandatoryText(e.target.value)} disabled={busy}
            maxLength={20000} rows={3} placeholder="JSON array; not inferred from free text"
            className="mt-1 w-full rounded-md border bg-background p-2 font-mono" />
        </label>
        <label className="mt-3 block text-sm">Optional preferred specifications
          <textarea value={preferredText} onChange={(e) => setPreferredText(e.target.value)} disabled={busy}
            maxLength={20000} rows={3} placeholder="JSON array, or [] when none apply"
            className="mt-1 w-full rounded-md border bg-background p-2 font-mono" />
        </label>
        <label className="mt-2 flex gap-2 text-sm"><input type="checkbox" checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)} disabled={busy} />
          I have included every mandatory condition from my request.</label>
        <button type="button" onClick={() => void handleRequirements()} disabled={busy || !confirmed}
          className="mt-3 rounded-md border px-3 py-2 text-sm disabled:opacity-50">Confirm specifications</button>
      </details>}

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
                Score: {Number(match.compatibility_score).toFixed(2)}/100
              </span>
            </div>

            <p className="mt-2 text-sm">{match.explanation}</p>

            <p className="mt-2 text-xs text-muted-foreground">
              Condition: {match.condition} · Current available quantity:{" "}
              {match.available_quantity}
            </p>

            <p className="mt-2 text-sm">Evidence coverage: {match.evidence_coverage ?? "Unknown"}% · {match.scoring_version}</p>
            {!match.currently_eligible && <p className="mt-2 text-sm text-red-600 dark:text-red-400">Stale or no longer eligible. Generate a new run before accepting.</p>}
            {match.warnings?.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">
              {match.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>}
            <details className="mt-2 text-sm"><summary className="cursor-pointer">Score evidence and contributions</summary>
              <p className="mt-1">Missing optional factors are excluded, not scored zero. Contributions below are normalized score points.</p>
              <div className="overflow-x-auto"><table className="mt-2 w-full text-left">
                <thead><tr><th>Factor</th><th>Value (0–1)</th><th>Points</th></tr></thead>
                <tbody>{Object.entries(match.factor_values ?? {}).map(([factor, value]) => <tr key={factor}>
                  <td className="pr-3">{factor}</td><td>{value === null ? "Missing" : Number(value).toFixed(3)}</td>
                  <td>{match.factor_contributions?.[factor] == null ? "Excluded" : Number(match.factor_contributions[factor]).toFixed(2)}</td>
                </tr>)}</tbody>
              </table></div>
            </details>

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
                    disabled={busy || !match.currently_eligible}
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
