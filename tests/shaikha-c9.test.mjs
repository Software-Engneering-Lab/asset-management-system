import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFilters, parseBasicReport, reportCsv, csvCell, csvFilename, displayCell,
  columnsFor, dateBasisFor, MAX_REPORT_ROWS } from '../app/protected/reports/records/record-model.ts';

const filters = { kind: 'requests', period_start: '2026-11-16', period_end: '2026-11-19', status: null };
const id = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const request = (n = 1) => ({ request_id: id(n), created_at: '2026-11-16T00:00:00+00:00',
  submitted_at: null, department: 'Demo Engineering', category: 'IT Equipment', quantity: 1,
  urgency: 'Normal', request_status: 'Submitted', purpose: 'Fictional teaching-lab test' });
const transferFilters = { ...filters, kind: 'transfers' };
const transfer = () => ({ transfer_id: id(), request_id: id(2), asset_id: id(3), asset_name: 'Demo laptop',
  sending_department: 'Demo IT', receiving_department: 'Demo Engineering', quantity: 2,
  received_quantity: 0, transfer_status: 'Released', approval_decided_at: '2026-11-19T23:59:59.999Z',
  released_at: null, received_at: null });
const report = (rows = [request()], f = filters) => ({ ...f, contract_version: 'c9-basic-v1',
  generated_at: '2026-11-22T12:00:00Z', date_basis: dateBasisFor(f.kind), limit: MAX_REPORT_ROWS,
  has_more: false, rows });

test('strict filters normalize all statuses without coercing objects', () => {
  assert.deepEqual(parseFilters({ ...filters, status: '' }), filters);
  for (const kind of [null, 'assets', { toString: () => 'requests' }])
    assert.throws(() => parseFilters({ ...filters, kind }));
});
test('real calendar dates and inclusive 366-day maximum', () => {
  assert.ok(parseFilters({ ...filters, period_start: '2024-01-01', period_end: '2024-12-31' }));
  for (const [start, end] of [['2026-02-29','2026-03-01'], ['2026-11-20','2026-11-19'],
    ['2024-01-01','2025-01-01'], ['0000-01-01','0000-01-02'], ['2026-1-01','2026-01-02']])
    assert.throws(() => parseFilters({ ...filters, period_start: start, period_end: end }));
});
test('statuses belong to the selected record type', () => {
  assert.throws(() => parseFilters({ ...filters, status: 'Completed' }));
  assert.throws(() => parseFilters({ ...transferFilters, status: 'Submitted' }));
  assert.equal(parseFilters({ ...transferFilters, status: 'Completed' }).status, 'Completed');
});
test('valid report strips unrequested fields', () => {
  const parsed = parseBasicReport(report([{ ...request(), private_field: 'not exported' }]), filters);
  assert.equal(parsed.rows[0].private_field, undefined);
  assert.equal(Object.keys(parsed.rows[0]).length, columnsFor('requests').length);
});
test('response must echo exact filters, date basis and contract', () => {
  for (const patch of [{ status: 'Submitted' }, { period_end: '2026-11-20' }, { date_basis: 'received_at' },
    { contract_version: 'legacy' }, { limit: 500 }, { generated_at: 'invalid' }, { has_more: 'false' }])
    assert.throws(() => parseBasicReport({ ...report(), ...patch }, filters));
});
test('duplicate IDs, missing fields and malformed references fail closed', () => {
  assert.throws(() => parseBasicReport(report([request(), request()]), filters));
  for (const patch of [{ request_id: 'invalid' }, { quantity: 0 }, { quantity: '1' },
    { quantity: 1.5 }, { purpose: undefined }, { department: null }, { created_at: '2026-11-16' }])
    assert.throws(() => parseBasicReport(report([{ ...request(), ...patch }]), filters));
});
test('UTC boundary includes entire last day but excludes following midnight', () => {
  assert.ok(parseBasicReport(report([{ ...request(), created_at: '2026-11-19T23:59:59.999Z' }]), filters));
  for (const time of ['2026-11-15T23:59:59Z', '2026-11-20T00:00:00Z', '2026-11-20T02:00:00+01:00'])
    assert.throws(() => parseBasicReport(report([{ ...request(), created_at: time }]), filters));
});
test('row statuses must match schema and selected filter', () => {
  assert.throws(() => parseBasicReport(report([{ ...request(), request_status: 'Completed' }]), filters));
  const f = { ...filters, status: 'Approved' };
  assert.throws(() => parseBasicReport(report([request()], f), f));
});
test('transfer contract preserves zero versus missing received quantity', () => {
  const zero = parseBasicReport(report([transfer()], transferFilters), transferFilters);
  assert.equal(zero.rows[0].received_quantity, 0);
  const missing = parseBasicReport(report([{ ...transfer(), received_quantity: null }], transferFilters), transferFilters);
  assert.equal(missing.rows[0].received_quantity, null);
  for (const received_quantity of [-1, 3, '0'])
    assert.throws(() => parseBasicReport(report([{ ...transfer(), received_quantity }], transferFilters), transferFilters));
});
test('CSV doubles quotes, keeps Arabic/newlines and uses BOM plus CRLF', () => {
  const csv = reportCsv(report([{ ...request(), purpose: 'مختبر, "Demo"\nNext line' }]));
  assert.ok(csv.startsWith('\uFEFF"Request ID"'));
  assert.ok(csv.includes('"مختبر, ""Demo""\nNext line"'));
  assert.ok(csv.endsWith('\r\n'));
});
test('formula-like and control-led cells get protective quoted prefix', () => {
  for (const text of ['=1+1', '+SUM(A1)', '-1+2', '@SUM(A1)', ' \t=1', '\r=1', '\ntext', '\ttext', '＝1', '＋1', '－1', '＠x'])
    assert.ok(csvCell(text).startsWith('"\'\t'), JSON.stringify(text));
  assert.equal(csvCell('ordinary text'), '"ordinary text"');
});
test('empty null CSV cell is distinct from numeric zero', () => {
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(0), '"0"');
  assert.equal(displayCell(null, { key: 'x', label: 'x' }), 'Not recorded');
});
test('CSV exports all loaded rows, including beyond page 25', () => {
  const csv = reportCsv(report(Array.from({ length: 26 }, (_, i) => request(i + 1))));
  assert.equal(csv.split('\r\n').length, 28);
  assert.ok(csv.includes(id(26)));
});
test('overflow is explicit and prevents incomplete CSV exports', () => {
  const rows = Array.from({ length: 1000 }, (_, i) => request(i + 1));
  assert.ok(parseBasicReport(report(rows), filters));
  const overflow = { ...report(rows), has_more: true };
  assert.ok(parseBasicReport(overflow, filters));
  assert.throws(() => reportCsv(overflow));
  assert.throws(() => parseBasicReport({ ...report(), has_more: true }, filters));
  assert.throws(() => parseBasicReport(report([...rows, request(1001)]), filters));
});
test('empty report exports headers only; filename has safe filter and snapshot labels', () => {
  assert.equal(reportCsv(report([])).split('\r\n').length, 2);
  assert.equal(csvFilename(report([])), 'shaikha-requests_2026-11-16_to_2026-11-19_all_20261122T120000000Z.csv');
});
