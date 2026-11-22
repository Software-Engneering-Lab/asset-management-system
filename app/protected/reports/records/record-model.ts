// C9's shared, dependency-free contract. No credentials or database writes.
export const MAX_REPORT_ROWS = 1000;
export const REQUEST_STATUSES = [
  "Draft", "Submitted", "Under Review", "Returned for Information", "Approved",
  "Reserved", "In Transfer", "Fulfilled", "Rejected", "Cancelled",
] as const;
export const TRANSFER_STATUSES = [
  "Approved", "Scheduled", "Released", "Receipt Discrepancy", "Completed", "Cancelled",
] as const;

export type RecordKind = "requests" | "transfers";
export type ReportFilters = {
  kind: RecordKind;
  period_start: string;
  period_end: string;
  status: string | null;
};
export type ReportRow = Record<string, string | number | null>;
export type BasicReport = ReportFilters & {
  contract_version: "c9-basic-v1";
  generated_at: string;
  date_basis: string;
  limit: number;
  has_more: boolean;
  rows: ReportRow[];
};
export type ReportColumn = { key: string; label: string; timestamp?: boolean };

const REQUEST_COLUMNS: readonly ReportColumn[] = [
  { key: "request_id", label: "Request ID" },
  { key: "created_at", label: "Created at (UTC)", timestamp: true },
  { key: "submitted_at", label: "Submitted at (UTC)", timestamp: true },
  { key: "department", label: "Requesting department" },
  { key: "category", label: "Category" },
  { key: "quantity", label: "Requested quantity" },
  { key: "urgency", label: "Urgency" },
  { key: "request_status", label: "Request status" },
  { key: "purpose", label: "Purpose" },
];
const TRANSFER_COLUMNS: readonly ReportColumn[] = [
  { key: "transfer_id", label: "Transfer ID" },
  { key: "request_id", label: "Request ID" },
  { key: "asset_id", label: "Asset ID" },
  { key: "asset_name", label: "Asset" },
  { key: "sending_department", label: "Sending department" },
  { key: "receiving_department", label: "Receiving department" },
  { key: "quantity", label: "Transfer quantity" },
  { key: "received_quantity", label: "Received quantity" },
  { key: "transfer_status", label: "Transfer status" },
  { key: "approval_decided_at", label: "Approval decision at (UTC)", timestamp: true },
  { key: "released_at", label: "Released at (UTC)", timestamp: true },
  { key: "received_at", label: "Received at (UTC)", timestamp: true },
];

export function columnsFor(kind: RecordKind): readonly ReportColumn[] {
  return kind === "requests" ? REQUEST_COLUMNS : TRANSFER_COLUMNS;
}
export function statusesFor(kind: RecordKind): readonly string[] {
  return kind === "requests" ? REQUEST_STATUSES : TRANSFER_STATUSES;
}
export function dateBasisFor(kind: RecordKind) {
  return kind === "requests" ? "resource_request.created_at" : "approval.decided_at";
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function dateOnly(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function timestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) &&
    /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseFilters(value: unknown): ReportFilters {
  if (!object(value) || (value.kind !== "requests" && value.kind !== "transfers") ||
      !dateOnly(value.period_start) || !dateOnly(value.period_end) ||
      value.period_end < value.period_start ||
      Date.parse(`${value.period_end}T00:00:00Z`) - Date.parse(`${value.period_start}T00:00:00Z`) > 365 * 86400000 ||
      !(value.status === null || typeof value.status === "string")) {
    throw new Error("Choose a record type and valid dates covering at most 366 inclusive days.");
  }
  const kind = value.kind as RecordKind;
  const status = value.status === "" ? null : value.status as string | null;
  if (status !== null && !statusesFor(kind).includes(status)) throw new Error("Choose a valid status for this record type.");
  return { kind, period_start: value.period_start, period_end: value.period_end, status };
}

export function parseBasicReport(value: unknown, filters: ReportFilters): BasicReport {
  if (!object(value) || value.contract_version !== "c9-basic-v1" || value.kind !== filters.kind ||
      value.period_start !== filters.period_start || value.period_end !== filters.period_end || value.status !== filters.status ||
      value.date_basis !== dateBasisFor(filters.kind) || !timestamp(value.generated_at) ||
      value.limit !== MAX_REPORT_ROWS || typeof value.has_more !== "boolean" ||
      !Array.isArray(value.rows) || value.rows.length > MAX_REPORT_ROWS ||
      (value.has_more && value.rows.length !== MAX_REPORT_ROWS)) {
    throw new Error("Unexpected report response. Check that the reviewed C9 migration is installed.");
  }
  const seen = new Set<string>();
  const idKey = filters.kind === "requests" ? "request_id" : "transfer_id";
  const statusKey = filters.kind === "requests" ? "request_status" : "transfer_status";
  const timeKey = filters.kind === "requests" ? "created_at" : "approval_decided_at";
  const start = Date.parse(`${filters.period_start}T00:00:00Z`);
  const end = Date.parse(`${filters.period_end}T00:00:00Z`) + 86400000;
  const rows: ReportRow[] = value.rows.map((row: unknown) => {
    if (!object(row) || typeof row[idKey] !== "string" || !uuid.test(row[idKey]) || seen.has(row[idKey])) throw new Error("Invalid or duplicate report row.");
    const normalized: ReportRow = {};
    for (const column of columnsFor(filters.kind)) {
      const cell = row[column.key];
      const nullable = ["submitted_at", "released_at", "received_at", "received_quantity"].includes(column.key);
      if (cell === null && nullable) { normalized[column.key] = null; continue; }
      if (["quantity", "received_quantity"].includes(column.key)) {
        if (typeof cell !== "number" || !Number.isSafeInteger(cell) || cell < (column.key === "quantity" ? 1 : 0)) throw new Error("Invalid report quantity.");
      } else if (typeof cell !== "string" || (column.timestamp && !timestamp(cell))) {
        throw new Error("Invalid report field.");
      }
      normalized[column.key] = cell as string | number;
    }
    for (const field of filters.kind === "requests" ? ["request_id"] : ["transfer_id", "request_id", "asset_id"]) {
      if (typeof row[field] !== "string" || !uuid.test(row[field])) throw new Error("Invalid record reference.");
    }
    if (!statusesFor(filters.kind).includes(String(row[statusKey])) ||
        (filters.status !== null && row[statusKey] !== filters.status)) throw new Error("Unexpected record status.");
    const time = Date.parse(String(row[timeKey]));
    if (time < start || time >= end) throw new Error("Record falls outside the requested UTC period.");
    if (typeof row.received_quantity === "number" && row.received_quantity > Number(row.quantity)) throw new Error("Received quantity exceeds transfer quantity.");
    seen.add(row[idKey]);
    return normalized;
  });
  return { ...filters, contract_version: "c9-basic-v1", generated_at: value.generated_at,
    date_basis: value.date_basis as string, limit: MAX_REPORT_ROWS, has_more: value.has_more, rows };
}

export function displayCell(value: string | number | null, column: ReportColumn) {
  if (value === null) return "Not recorded";
  return column.timestamp ? new Date(String(value)).toISOString().slice(0, 19).replace("T", " ") + " UTC" : String(value);
}

// CSV for human viewing, not a lossless machine-import format. Formula-like
// fields receive an apostrophe + tab prefix inside quotes. Quoting also keeps
// delimiters/newlines/quotes inside one cell. See docs/SHAIKHA_C9_HANDOFF.md.
// No CSV escaping method guarantees safety after arbitrary spreadsheet edits.
export function csvCell(value: string | number | null) {
  let text = value === null ? "" : String(value);
  if (/^[\s\u0000-\u001f\u007f\uFEFF]*[=+\-@＝＋－＠]/u.test(text) || /^[\t\r\n]/.test(text)) {
    text = "'\t" + text;
  }
  return `"${text.replaceAll('"', '""')}"`;
}

export function reportCsv(report: BasicReport) {
  const checked = parseBasicReport(report, parseFilters(report));
  if (checked.has_more) throw new Error("Narrow the period/status before exporting: the report exceeds 1,000 rows.");
  const columns = columnsFor(checked.kind);
  const lines = [columns.map((column) => csvCell(column.label)).join(",")];
  for (const row of checked.rows) {
    lines.push(columns.map((column) => csvCell(row[column.key])).join(","));
  }
  // UTF-8 BOM assists Excel with Arabic text. Null remains empty, not zero.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}

export function csvFilename(report: BasicReport) {
  const filters = parseFilters(report);
  if (!timestamp(report.generated_at)) throw new Error("Invalid snapshot time.");
const time = new Date(report.generated_at).toISOString()
  .replaceAll("-", "").replaceAll(":", "").replaceAll(".", "");  const status = (filters.status ?? "all").toLowerCase().replaceAll(" ", "-");
  return `shaikha-${filters.kind}_${filters.period_start}_to_${filters.period_end}_${status}_${time}.csv`;
}
