"use server";

import { createClient } from "@/lib/supabase/server";
import { parseBasicReport, parseFilters, type BasicReport, type ReportFilters } from "./record-model";

type LoadResult = { success: true; report: BasicReport } | { success: false; message: string };

export async function loadBasicReport(input: ReportFilters): Promise<LoadResult> {
  let filters: ReportFilters;
  try { filters = parseFilters(input); }
  catch (error) { return { success: false, message: error instanceof Error ? error.message : "Invalid report filters." }; }

  try {
    const db = await createClient();
    const { data: auth, error: authError } = await db.auth.getUser();
    if (authError || !auth.user) return { success: false, message: "Please sign in." };

    // Normal signed-in client only: the RPC independently checks current admin,
    // active profile and active department before reading any business records.
    const { data, error } = await db.rpc("shaikha_basic_report_rows", {
      p_kind: filters.kind,
      p_period_start: filters.period_start,
      p_period_end: filters.period_end,
      p_status: filters.status,
    });
    if (error) {
      if (error.code === "42501") return { success: false, message: "An active admin profile and role are required for basic reports." };
      if (["PGRST202", "42883"].includes(error.code)) return { success: false, message: "Basic reports are not enabled yet. The new reviewed C9 migration must be applied once." };
      if (["22023", "22007", "22008"].includes(error.code)) return { success: false, message: "Check the record type, dates and status. Maximum period: 366 inclusive days." };
      return { success: false, message: "Unable to load report records. Refresh before retrying." };
    }
    try { return { success: true, report: parseBasicReport(data, filters) }; }
    catch { return { success: false, message: "Unexpected basic-report response. No sample data or CSV was substituted." }; }
  } catch {
    return { success: false, message: "Report access could not be confirmed. Please try again." };
  }
}
