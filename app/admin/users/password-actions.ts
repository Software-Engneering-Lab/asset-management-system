"use server";

// Admin sets a TEMPORARY password for a user who forgot hers (C1, FR-03).
// Nobody can read a user's real password; this replaces it.
// Leave the box empty to have one generated. The temporary password is shown
// to the admin ONCE (short-lived cookie, 2 minutes) and is never stored in a table.
// The reset itself (never the password) is written to the audit log (FR-05).
import { randomInt } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthService } from "@/lib/auth/AuthService";
import { ROLES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const MIN_LENGTH = 8;
import { TEMP_PASSWORD_COOKIE } from "./temp-password-cookie";

const back = (key: "msg" | "error", text: string): never =>
  redirect(`/admin/users?${key}=${encodeURIComponent(text)}`);

/** e.g. "Kp7-xR4m-Tq9z": easy to read aloud (no 0/O, 1/l/I). */
function generateTemporaryPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const part = (n: number) => Array.from({ length: n }, () => chars[randomInt(chars.length)]).join("");
  return `${part(3)}-${part(4)}-${part(4)}`;
}

export async function setTemporaryPasswordAction(formData: FormData) {
  const admin = await AuthService.requireRole(ROLES.ADMIN);
  const userId = String(formData.get("user_id") ?? "");
  const typed = String(formData.get("temp_password") ?? "").trim();
  const password = typed === "" ? generateTemporaryPassword() : typed;

  if (!userId) back("error", "User not found.");
  if (userId === admin.userId) back("error", "Use the change-password page to change your own password.");
  if (password.length < MIN_LENGTH) back("error", `The temporary password needs at least ${MIN_LENGTH} characters.`);

  // 1. Change the password in Supabase Auth (needs the secret key)
  const { error } = await createAdminClient().auth.admin.updateUserById(userId, { password });
  if (error) back("error", `Password not changed: ${error.message}`);

  // 2. Audit entry (FR-05). If it fails, do not report success.
  const supabase = await createClient();
  const { error: auditError } = await supabase.rpc("record_password_reset", { p_user_id: userId });
  if (auditError) back("error", `Password changed, but the audit entry failed: ${auditError.message}`);

  // 3. Show it to the admin once: private cookie, this page only, 2 minutes.
  (await cookies()).set(TEMP_PASSWORD_COOKIE, JSON.stringify({ userId, password }), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/admin/users",
    maxAge: 120,
  });

  revalidatePath("/admin/users");
  back("msg", "password_set");
}
