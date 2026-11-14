"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  generateReport,
  loadReports,
  reviewReport,
  type ReportRecord,
} from "./actions";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const metrics = [
  ["submitted_requests", "Requests submitted"],
  ["completed_transfers", "Transfers completed"],
  ["received_units_known", "Received units with recorded quantities"],
  [
    "transfers_missing_received_quantity",
    "Completed transfers missing received quantities",
  ],
] as const;

export default function ReportsPage() {
  const [reports, setReports] = useState<ReportRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const running = useRef(false);

  const fieldClass =
    "w-full rounded-md border border-input bg-background px-3 py-2";

  async function refreshReports() {
    setLoading(true);
    setError("");

    try {
      const result = await loadReports();

      if (result.success) {
        setReports(result.reports);
      } else {
        setReports(null);
        setError(result.message);
      }
    } catch {
      setReports(null);
      setError("Unable to load reports.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshReports();
  }, []);

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;

    const data = new FormData(event.currentTarget);

    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await generateReport(data);

      if (!result.success) {
        setError(result.message);
        return;
      }

      setMessage(result.message);
      await refreshReports();
    } catch {
      setError("Generation could not be confirmed. Refresh before retrying.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  async function handleReview(
    event: FormEvent<HTMLFormElement>,
    report: ReportRecord,
  ) {
    event.preventDefault();
    if (running.current) return;

    const data = new FormData(event.currentTarget);
    const nativeEvent = event.nativeEvent as SubmitEvent;
    const button = nativeEvent.submitter;

    const publish =
      button instanceof HTMLButtonElement && button.value === "publish";

    const text = String(data.get("summary_text") ?? "");

    if (publish && data.get("confirmed") !== "on") {
      setError(
        "Confirm that you checked the summary against the figures before publishing.",
      );
      return;
    }

    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");

    try {
      const result = await reviewReport(
        report.summary_id,
        text,
        publish,
        report.revision,
      );

      if (!result.success) {
        setError(result.message);
        return;
      }

      setMessage(result.message);
      await refreshReports();
    } catch {
      setError("Review could not be confirmed. Refresh to check the status.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="w-full space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Operational Reports</h1>
          <p className="mt-2 text-muted-foreground">
            Database figures, AI summaries and human-controlled publication.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void refreshReports()}
          disabled={busy || loading}
          className="rounded-md border px-4 py-2 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-red-500 p-4">
          {error}
        </div>
      )}

      <p role="status" className="text-sm">
        {busy ? "Working—please wait…" : message}
      </p>

      {loading && reports === null && (
        <p>Checking report access…</p>
      )}

      {!loading && reports === null && (
        <div className="rounded-lg border p-6">
          <h2 className="font-semibold">Report workspace unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Reports require the reviewed AI 5 migration and an active admin
            profile. A requester account does not automatically have access.
          </p>
        </div>
      )}

      {reports !== null && (
        <>
          <section className="rounded-lg border p-6">
            <h2 className="text-xl font-semibold">Generate a draft</h2>

            <p className="mb-4 mt-2 text-sm text-muted-foreground">
              Dates are inclusive, in UTC, with a maximum period of 366 days.
              Only aggregate figures and reporting dates are sent to Gemini.
              Use fictional demonstration records.
            </p>

            <form onSubmit={handleGenerate}>
              <fieldset
                disabled={busy || loading}
                className="space-y-4 disabled:opacity-60"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="block">Start date</span>
                    <input
                      name="period_start"
                      type="date"
                      required
                      className={fieldClass}
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="block">End date</span>
                    <input
                      name="period_end"
                      type="date"
                      required
                      className={fieldClass}
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                >
                  Generate report draft
                </button>
              </fieldset>
            </form>
          </section>

          <section className="space-y-5">
            <h2 className="text-xl font-semibold">Latest 50 reports</h2>

            {reports.length === 0 && (
              <p>No report drafts have been created yet.</p>
            )}

            {reports.map((report) => {
              const snapshot = object(report.calculated_figures)
                ? report.calculated_figures
                : null;

              const figures =
                snapshot && object(snapshot.figures)
                  ? snapshot.figures
                  : null;

              const published = report.review_status === "published";

              return (
                <article
                  key={`${report.summary_id}-${report.revision}`}
                  className="space-y-4 rounded-lg border p-6"
                >
                  <header className="flex flex-wrap justify-between gap-3">
                    <div>
                      <h3 className="font-semibold">
                        {report.report_type}: {report.period_start} to{" "}
                        {report.period_end}
                      </h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Source:{" "}
                        {report.generation_method === "ai"
                          ? "AI-generated draft"
                          : report.generation_method === "manual"
                            ? "Database-generated fallback—not AI"
                            : "Generation method not recorded"}
                      </p>
                    </div>

                    <span className="self-start rounded-full bg-muted px-3 py-1 text-sm">
                      {report.review_status}
                    </span>
                  </header>

                  <dl className="grid gap-3 sm:grid-cols-2">
                    {metrics.map(([key, label]) => (
                      <div key={key} className="rounded-md bg-muted p-3">
                        <dt className="text-sm">{label}</dt>
                        <dd className="mt-1 text-xl font-semibold">
                          {figures && typeof figures[key] === "number"
                            ? String(figures[key])
                            : "Not recorded"}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <p className="text-xs text-muted-foreground">
                    Requests are counted by submission date. Transfers are
                    counted by receipt date and Completed status. Known received
                    units exclude missing quantities. Figures are a saved
                    snapshot, not live totals.
                  </p>

                  {figures &&
                    typeof figures.transfers_missing_received_quantity ===
                      "number" &&
                    figures.transfers_missing_received_quantity > 0 && (
                      <p className="text-sm font-medium">
                        Data warning: the received-unit total is incomplete
                        because some completed transfers have no recorded
                        received quantity.
                      </p>
                    )}

                  <details>
                    <summary className="cursor-pointer font-medium">
                      Original generated draft
                    </summary>
                    <p className="mt-3 whitespace-pre-wrap text-sm">
                      {report.draft_text}
                    </p>
                  </details>

                  {published ? (
                    <div>
                      <h4 className="font-semibold">Published summary</h4>
                      <p className="mt-2 whitespace-pre-wrap">
                        {report.published_text}
                      </p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Published:{" "}
                        {report.published_at
                          ? new Date(report.published_at).toLocaleString()
                          : "Not recorded"}
                      </p>
                    </div>
                  ) : (
                    <form
                      onSubmit={(event) => void handleReview(event, report)}
                      className="space-y-3"
                    >
                      <label className="block space-y-2">
                        <span className="block font-medium">
                          Admin-edited summary
                        </span>
                        <textarea
                          name="summary_text"
                          defaultValue={
                            report.published_text ?? report.draft_text
                          }
                          required
                          maxLength={8000}
                          rows={6}
                          disabled={busy || loading}
                          className={fieldClass}
                        />
                      </label>

                      <label className="flex items-start gap-2 text-sm">
                        <input
                          name="confirmed"
                          type="checkbox"
                          disabled={busy || loading}
                          className="mt-1"
                        />
                        <span>
                          I checked the wording against the calculated figures
                          and approve this text for publication.
                        </span>
                      </label>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="submit"
                          value="save"
                          disabled={busy || loading}
                          className="rounded-md border px-4 py-2 disabled:opacity-50"
                        >
                          Save reviewed text
                        </button>

                        <button
                          type="submit"
                          value="publish"
                          disabled={busy || loading}
                          className="rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-50"
                        >
                          Publish reviewed report
                        </button>
                      </div>
                    </form>
                  )}

                  <p className="break-all text-xs text-muted-foreground">
                    Reference: {report.summary_id}
                  </p>
                </article>
              );
            })}
          </section>
        </>
      )}
    </section>
  );
}