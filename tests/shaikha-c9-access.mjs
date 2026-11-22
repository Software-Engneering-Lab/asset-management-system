// Run locally with Node 24+ and --env-file=.env.local. Never paste passwords
// into this file or commit them. Uses only the normal publishable/anon key.
import assert from 'node:assert/strict';
import { parseBasicReport } from '../app/protected/reports/records/record-model.ts';

async function main() {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = process.env.shaikhaC9Email;
  const password = process.env.shaikhaC9Password;
  const expected = process.env.shaikhaC9Expected;
  if (!base || !key || !email || !password || !['admin', 'denied'].includes(expected))
    throw new Error('Missing settings: use the handoff commands and choose admin or denied.');
  const url = new URL(base);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid configured Supabase URL.');
  const filters = { period_start: '2026-11-01', period_end: '2026-11-30', status: null };
  async function request(path, body, token) {
    const response = await fetch(new URL(path, url), { method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    const data = await response.json();
    return { ok: response.ok, data };
  }
  // A missing RPC, connection error or arbitrary failure must NOT pass as denial.
  for (const kind of ['requests', 'transfers']) {
    const result = await request('/rest/v1/rpc/shaikha_basic_report_rows', {
      p_kind: kind, p_period_start: filters.period_start, p_period_end: filters.period_end, p_status: null,
    });
    assert.equal(result.ok, false, 'Anonymous client unexpectedly allowed.');
    assert.equal(result.data?.code, '42501', 'Anonymous check did not return permission denied; check migration/setup.');
    console.log(`PASS: anonymous denied — ${kind}`);
  }
  const login = await request('/auth/v1/token?grant_type=password', { email, password });
  if (!login.ok || !login.data?.access_token) throw new Error('Demo login failed. Check the authorized account and password.');
  const token = login.data.access_token;
  for (const kind of ['requests', 'transfers']) {
    const result = await request('/rest/v1/rpc/shaikha_basic_report_rows', {
      p_kind: kind, p_period_start: filters.period_start, p_period_end: filters.period_end, p_status: null,
    }, token);
    if (expected === 'admin') {
      assert.equal(result.ok, true, 'Admin report failed; check active profile, department, role and migration.');
      const report = parseBasicReport(result.data, { ...filters, kind });
      console.log(`PASS: active admin reads ${kind} — ${report.rows.length} rows${report.has_more ? ' (capped)' : ''}`);
    } else {
      assert.equal(result.ok, false, 'Non-admin unexpectedly allowed.');
      assert.equal(result.data?.code, '42501', 'Expected permission denial, not a setup/connection failure.');
      console.log(`PASS: signed-in account denied — ${kind}`);
    }
  }
  if (expected === 'admin') {
    for (const patch of [{ p_kind: 'assets' }, { p_status: 'Completed' },
      { p_period_start: '2026-12-01' }, { p_period_start: '2024-01-01' }]) {
      const result = await request('/rest/v1/rpc/shaikha_basic_report_rows', { p_kind: 'requests',
        p_period_start: filters.period_start, p_period_end: filters.period_end, p_status: null, ...patch }, token);
      assert.equal(result.ok, false, 'Invalid filters unexpectedly accepted.');
      assert.equal(result.data?.code, '22023', 'Expected filter rejection, not an unrelated error.');
    }
    console.log('PASS: admin invalid filters rejected by database');
  }
  // No business writes, token persistence or global logout of shared accounts.
}

main().catch((error) => {
  console.error(`STOP: ${error instanceof Error ? error.message : 'Access test failed.'}`);
  process.exitCode = 1;
});
