import { redirect } from "next/navigation";
import { throwIfError } from "@/lib/services/DataLoadError";
import { createClient } from "@/lib/supabase/server";
import { one, type CurrentUser, type Joined } from "@/lib/types";
import { ROLES, type RoleName } from "@/lib/constants";

const GENERIC_SIGN_IN_ERROR = "Sign-in failed. Check your details and try again.";

/**
 * C1 – Login and roles (FR-01, FR-02).
 * Shaikha and Renad: import getCurrentUser / requireUser / requireRole from here.
 */
export class AuthService {
  /** Signs in with Supabase Auth. Returns a general error only (FR-01). */
  static async signIn(email: string, password: string): Promise<{ ok: boolean; message?: string }> {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: GENERIC_SIGN_IN_ERROR };

    // The login must also have an active app_user row; otherwise refuse with the same message.
    const user = await AuthService.getCurrentUser();
    if (!user) {
      await supabase.auth.signOut();
      return { ok: false, message: GENERIC_SIGN_IN_ERROR };
    }
    return { ok: true };
  }

  static async signOut(): Promise<void> {
    const supabase = await createClient();
    await supabase.auth.signOut(); // invalidates the session (NFR-SE01)
  }

  /** The signed-in user with department and roles, or null. */
  static async getCurrentUser(): Promise<CurrentUser | null> {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const { data: appUser, error: profileError } = await supabase
      .from("app_user")
      .select("user_id, full_name, email, department_id, account_status, department(name)")
      .eq("user_id", user.id)
      .maybeSingle();

    throwIfError(profileError, "your profile");
    if (!appUser || appUser.account_status !== "active") return null;

    const { data: roleRows, error: rolesError } = await supabase
      .from("user_role")
      .select("role(role_name)")
      .eq("user_id", user.id);
    throwIfError(rolesError, "your roles");

    const roles = (roleRows ?? [])
      .map((r: { role: Joined<{ role_name: string }> }) => one(r.role)?.role_name)
      .filter(Boolean) as RoleName[];

    const dept = one(appUser.department as Joined<{ name: string }>);

    return {
      userId: appUser.user_id,
      fullName: appUser.full_name,
      email: appUser.email,
      departmentId: appUser.department_id,
      departmentName: dept?.name ?? null,
      roles,
    };
  }

  /** True when a Supabase login session exists (even without an active profile). */
  static async hasSession(): Promise<boolean> {
    const supabase = await createClient();
    const { data } = await supabase.auth.getClaims();
    return Boolean(data?.claims);
  }

  /**
   * First page after login: one every role is allowed to open.
   * Staff who manage assets go to their department list; everyone else to search.
   */
  static homePath(user: CurrentUser): string {
    return AuthService.hasRole(user, ROLES.CUSTODIAN, ROLES.ADMIN, ROLES.APPROVER) ? "/assets" : "/search";
  }

  static hasRole(user: CurrentUser, ...allowed: RoleName[]): boolean {
    return user.roles.some((r) => allowed.includes(r));
  }

  /** Use at the top of every protected page / server action. */
  static async requireUser(): Promise<CurrentUser> {
    const user = await AuthService.getCurrentUser();
    if (!user) redirect("/auth/login");
    return user;
  }

  /** Server-side permission check: hiding a button is not enough (C1). */
  static async requireRole(...allowed: RoleName[]): Promise<CurrentUser> {
    const user = await AuthService.requireUser();
    if (!AuthService.hasRole(user, ...allowed)) redirect("/access-denied");
    return user;
  }
}
