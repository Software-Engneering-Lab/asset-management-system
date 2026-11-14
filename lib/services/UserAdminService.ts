import { createClient } from "@/lib/supabase/server";

export interface UserWithRoles {
  user_id: string;
  full_name: string;
  email: string;
  account_status: string;
  department_name: string | null;
  roles: { user_role_id: string; role_name: string }[];
}

/**
 * C1 – role assignment by the System Administrator (FR-02, FR-03, FR-05).
 * Login accounts themselves are created in Supabase Auth (it stores the passwords).
 */
export class UserAdminService {
  static async listRoles(): Promise<{ role_id: string; role_name: string }[]> {
    const supabase = await createClient();
    const { data } = await supabase.from("role").select("role_id, role_name").order("role_name");
    return data ?? [];
  }

  static async listUsers(): Promise<UserWithRoles[]> {
    const supabase = await createClient();
    const [{ data: users }, { data: links }] = await Promise.all([
      supabase
        .from("app_user")
        .select("user_id, full_name, email, account_status, department(name)")
        .order("full_name"),
      supabase.from("user_role").select("user_role_id, user_id, role(role_name)"),
    ]);

    return (users ?? []).map((u: any) => {
      const dept = Array.isArray(u.department) ? u.department[0] : u.department;
      return {
        user_id: u.user_id,
        full_name: u.full_name,
        email: u.email,
        account_status: u.account_status,
        department_name: dept?.name ?? null,
        roles: (links ?? [])
          .filter((l: any) => l.user_id === u.user_id)
          .map((l: any) => ({
            user_role_id: l.user_role_id,
            role_name: Array.isArray(l.role) ? l.role[0]?.role_name : l.role?.role_name,
          })),
      };
    });
  }

  /** Signed-up login accounts that do not have a profile yet. */
  static async listUnprovisioned(): Promise<{ user_id: string; email: string; created_at: string }[]> {
    const supabase = await createClient();
    const { data } = await supabase.rpc("list_unprovisioned_users");
    return (data ?? []) as { user_id: string; email: string; created_at: string }[];
  }

  /** FR-03: link a login account to a profile and department. */
  static async provisionProfile(userId: string, fullName: string, departmentId: string): Promise<{ error?: string }> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("provision_profile", {
      p_user_id: userId,
      p_full_name: fullName,
      p_department_id: departmentId,
    });
    return error ? { error: error.message } : {};
  }

  /** FR-03: activate or deactivate an account. */
  static async setAccountStatus(userId: string, status: "active" | "inactive"): Promise<{ error?: string }> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("set_account_status", { p_user_id: userId, p_status: status });
    return error ? { error: error.message } : {};
  }

  static async assignRole(userId: string, roleId: string): Promise<{ error?: string }> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("assign_user_role", { p_user_id: userId, p_role_id: roleId });
    return error ? { error: error.message } : {};
  }

  static async removeRole(userRoleId: string): Promise<{ error?: string }> {
    const supabase = await createClient();
    const { error } = await supabase.rpc("remove_user_role", { p_user_role_id: userRoleId });
    return error ? { error: error.message } : {};
  }
}
