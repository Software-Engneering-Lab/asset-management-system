"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { loadBasicReport } from "./actions";
import { columnsFor, csvFilename, displayCell, reportCsv, statusesFor,
  type BasicReport, type RecordKind } from "./record-model";

const PAGE_SIZE = 25;

export default function BasicReportsPage() {
  const [kind, setKind] = useState<RecordKind>("requests");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [status, setStatus] = useState("");
  const [report, setReport] = useState<BasicReport | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const running = useRef(false);
  const fieldClass = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2";

  const filtersChanged = report !== null && (report.kind !== kind || report.period_start !== start ||
    report.period_end !== end || report.status !== (status || null));

  async function handleLoad(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    setReport(null);
    setPage(0);
    try {
      const result = await loadBasicReport({ kind, period_start: start, period_end: end, status: status || null });
      if (result.success) setReport(result.report); else setError(result.message);
    } catch { setError("Unable to load records. No CSV was generated."); }
    finally { running.current = false; setBusy(false); }
  }

  function downloadCsv() {
    if (!report || filtersChanged || busy || report.has_more) return;
    try {
      const contents = reportCsv(report);
      const url = URL.createObjectURL(new Blob([contents], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = csvFilename(report);
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`CSV download requested for all ${report.rows.length} loaded rows, not only this table page.`);
      setError("");
    } catch { setError("CSV could not be generated. Reload the report before retrying."); }
  }

  const columns = report ? columnsFor(report.kind) : [];
  const pageCount = report ? Math.max(1, Math.ceil(report.rows.length / PAGE_SIZE)) : 1;
  const visibleRows = report?.rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) ?? [];

  return <section className="w-full space-y-6">
    <header>
      <Link href="/protected/reports" className="text-sm underline">Back to AI summaries</Link>
      <h1 className="mt-3 text-3xl font-bold">Basic Reports and CSV</h1>
      <p className="mt-2 text-muted-foreground">C9 — admin-only request and transfer records. Read-only; no AI, approvals or stock changes.</p>
    </header>

    <form onSubmit={handleLoad} className="rounded-lg border p-5">
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-60">
        <legend className="font-semibold">Report filters</legend>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm">Record type
            <select value={kind} onChange={(event) => { setKind(event.target.value as RecordKind); setStatus(""); }} className={fieldClass}>
              <option value="requests">Requests</option><option value="transfers">Transfers</option>
            </select>
          </label>
          <label className="text-sm">Start date (UTC)
            <input type="date" required value={start} onChange={(event) => setStart(event.target.value)} className={fieldClass} />
          </label>
          <label className="text-sm">End date (UTC)
            <input type="date" required value={end} onChange={(event) => setEnd(event.target.value)} className={fieldClass} />
          </label>
          <label className="text-sm">Status
            <select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}>
              <option value="">All statuses</option>
              {statusesFor(kind).map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <p className="text-sm text-muted-foreground">Inclusive UTC dates; maximum 366 days. Requests use creation time, including drafts. Transfers use the linked approval decision time because the shared transfer table has no creation timestamp. These are not AI5&apos;s submitted/received-date aggregate totals.</p>
        <button type="submit" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">{busy ? "Loading…" : "Load report"}</button>
      </fieldset>
    </form>

    {error && <p role="alert" className="rounded-md border border-red-500 p-4">{error}</p>}
    <p role="status" className="text-sm">{message}</p>

    {report && <section className="space-y-4 rounded-lg border p-5" aria-label="Loaded report">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">{report.kind === "requests" ? "Requests" : "Transfers"}: {report.period_start} to {report.period_end}</h2>
          <p className="mt-1 text-sm">Loaded rows: {report.rows.length}{report.has_more ? "+" : ""} · Status: {report.status ?? "All"}</p>
          <p className="mt-1 text-xs text-muted-foreground">Loaded at {displayCell(report.generated_at, { key: "generated_at", label: "Loaded", timestamp: true })}. Date basis: {report.date_basis}. Reload to see later database changes.</p>
        </div>
        <button type="button" onClick={downloadCsv} disabled={busy || filtersChanged || report.has_more}
          className="rounded-md border px-4 py-2 disabled:opacity-50">Export all loaded rows as CSV</button>
      </div>

      {filtersChanged && <p role="status" className="rounded-md border p-3 text-sm">Filters changed. The table still shows the labelled previous result; load the report again before exporting.</p>}
      {report.has_more && <p role="alert" className="rounded-md border border-amber-500 p-3 text-sm">More than 1,000 records match. Only the first 1,000 are displayed, and export is disabled to avoid a silently incomplete CSV. Narrow the date period or status.</p>}

      <p className="text-xs text-muted-foreground">CSV includes every loaded row across table pages. Empty values mean not recorded, not zero. Formula-like text is prefixed for spreadsheet viewing; do not enable formulas or remove protective prefixes. Saving/reopening in spreadsheet software can change protection.</p>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="mb-2 text-left">{report.kind === "requests" ? "Request" : "Transfer"} records — page {page + 1} of {pageCount}</caption>
          <thead><tr>{columns.map((column) => <th key={column.key} scope="col" className="whitespace-nowrap border-b p-2">{column.label}</th>)}</tr></thead>
          <tbody>
            {visibleRows.length === 0 ? <tr><td colSpan={columns.length} className="p-4 text-muted-foreground">No records match these filters.</td></tr> : visibleRows.map((row) => <tr key={String(row[report.kind === "requests" ? "request_id" : "transfer_id"])}>
              {columns.map((column) => <td key={column.key} className="min-w-24 max-w-xs break-words border-b p-2 align-top whitespace-pre-wrap">{displayCell(row[column.key], column)}</td>)}
            </tr>)}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" disabled={busy || page === 0} onClick={() => setPage((value) => value - 1)} className="rounded-md border px-3 py-2 disabled:opacity-50">Previous</button>
        <span className="text-sm">Page {page + 1} / {pageCount}</span>
        <button type="button" disabled={busy || page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)} className="rounded-md border px-3 py-2 disabled:opacity-50">Next</button>
      </div>
    </section>}
  </section>;
}
