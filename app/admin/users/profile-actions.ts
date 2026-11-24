"use server";

// Admin updates an account's name or department (C1, FR-03 "update").
// The database validates it and writes an audit entry with before/after values (FR-05).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthService } from "@/lib/auth/AuthService";
import { ROLES } from "@/lib/constants";
import { createClient } from "@/lib/supabase/server";

export async function updateProfileAction(formData: FormData) {
  await AuthService.requireRole(ROLES.ADMIN);
  const userId = String(formData.get("user_id") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const departmentId = String(formData.get("department_id") ?? "");

  if (!userId || !fullName || !departmentId) {
    redirect(`/admin/users?error=${encodeURIComponent("Full name and department are required.")}`);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("admin_update_profile", {
    p_user_id: userId,
    p_full_name: fullName,
    p_department_id: departmentId,
  });
  if (error) redirect(`/admin/users?error=${encodeURIComponent(error.message)}`);

  revalidatePath("/admin/users");
  redirect("/admin/users?msg=saved");
}
