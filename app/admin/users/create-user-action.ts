"use server";

// Admin creates a new user from the app (C1, FR-03): login + profile + roles.
// Follows Phase 4–5 Figure 2.2a: 1.2 Validate account and role data → 1.4 Save
// (one database step, one audit entry) → account confirmation to the admin.
// Every user gets at least one role (class diagram: AppUser holds Role 1..*).
// A temporary password is generated (or typed) and shown to the admin ONCE.
import { randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthService } from "@/lib/auth/AuthService";
import { ROLES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { TEMP_PASSWORD_COOKIE } from "./temp-password-cookie";

const MIN_LENGTH = 8;
const back = (key: "msg" | "error", text: string): never =>
  key === "error"
    ? redirect(`/admin/users/new?error=${encodeURIComponent(text)}`)
    : redirect(`/admin/users?msg=${encodeURIComponent(text)}`);

function generateTemporaryPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const part = (n: number) => Array.from({ length: n }, () => chars[randomInt(chars.length)]).join("");
  return `${part(3)}-${part(4)}-${part(4)}`;
}

export async function createUserAction(formData: FormData) {
  await AuthService.requireRole(ROLES.ADMIN);

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const departmentId = String(formData.get("department_id") ?? "");
  const roleIds = formData.getAll("role_ids").map(String).filter(Boolean);
  const typed = String(formData.get("temp_password") ?? "").trim();
  const password = typed === "" ? generateTemporaryPassword() : typed;

  if (!fullName || !email || !departmentId) back("error", "Full name, email and department are required.");
  if (roleIds.length === 0) back("error", "Roles: select at least one role.");
  if (password.length < MIN_LENGTH) back("error", `The temporary password needs at least ${MIN_LENGTH} characters.`);

  // 1. Login in Supabase Auth (needs the secret key)
  const adminClient = createAdminClient();
  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // created by the admin: no confirmation email needed
    user_metadata: { full_name: fullName },
  });
  if (error || !data.user) return back("error", `Account not created: ${error?.message ?? "unknown error"}`);
  const newUserId = data.user.id;

  // 2. Validate and save profile + roles in ONE database step, with one audit entry
  const supabase = await createClient();
  const { error: saveError } = await supabase.rpc("admin_create_account", {
    p_user_id: newUserId,
    p_full_name: fullName,
    p_department_id: departmentId,
    p_role_ids: roleIds,
  });
  if (saveError) {
    await adminClient.auth.admin.deleteUser(newUserId); // undo step 1: no half-made accounts
    back("error", `Account not created: ${saveError.message}`);
  }

  // 3. Show the temporary password to the admin once (2 minutes, never stored)
  (await cookies()).set(TEMP_PASSWORD_COOKIE, JSON.stringify({ userId: newUserId, password }), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin/users",
    maxAge: 120,
  });

  revalidatePath("/admin/users");
  back("msg", "password_set");
}
