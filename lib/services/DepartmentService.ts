import { createClient } from "@/lib/supabase/server";
import { throwIfError } from "@/lib/services/DataLoadError";
import type { Department } from "@/lib/types";

/** C2 – departments (FR-04). Only the System Administrator may write (enforced by RLS). */
export class DepartmentService {
  static async list(activeOnly = false): Promise<Department[]> {
    const supabase = await createClient();
    let query = supabase.from("department").select("department_id, code, name, is_active").order("name");
    if (activeOnly) query = query.eq("is_active", true);
    const { data, error } = await query;
    throwIfError(error, "departments");
    return (data ?? []) as Department[];
  }

  static async create(code: string, name: string): Promise<{ error?: string }> {
    const supabase = await createClient();
    const { error } = await supabase.from("department").insert({ code, name, is_active: true });
    if (!error) return {};
    if (error.code === "23505") return { error: `Department code "${code}" is already in use.` };
    if (error.code === "42501") return { error: "You do not have permission to manage departments." };
    return { error: "The department could not be saved." };
  }

  static async setActive(departmentId: string, isActive: boolean): Promise<{ error?: string }> {
    const supabase = await createClient();
    const { error } = await supabase
      .from("department")
      .update({ is_active: isActive })
      .eq("department_id", departmentId);
    return error ? { error: "The department could not be updated." } : {};
  }
}
