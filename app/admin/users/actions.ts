"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AuthService } from "@/lib/auth/AuthService";
import { UserAdminService } from "@/lib/services/UserAdminService";
import { ROLES } from "@/lib/constants";

function done(error?: string): never {
  revalidatePath("/admin/users");
  redirect(error ? `/admin/users?error=${encodeURIComponent(error)}` : "/admin/users?msg=saved");
}

export async function assignRoleAction(formData: FormData): Promise<void> {
  await AuthService.requireRole(ROLES.ADMIN);
  const userId = String(formData.get("user_id") ?? "");
  const roleId = String(formData.get("role_id") ?? "");
  if (!roleId) done("Choose a role to assign.");
  const result = await UserAdminService.assignRole(userId, roleId);
  done(result.error);
}

export async function removeRoleAction(formData: FormData): Promise<void> {
  await AuthService.requireRole(ROLES.ADMIN);
  const result = await UserAdminService.removeRole(String(formData.get("user_role_id") ?? ""));
  done(result.error);
}

export async function provisionProfileAction(formData: FormData): Promise<void> {
  await AuthService.requireRole(ROLES.ADMIN);
  const userId = String(formData.get("user_id") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const departmentId = String(formData.get("department_id") ?? "");
  if (!fullName || !departmentId) done("Enter a full name and choose a department.");
  const result = await UserAdminService.provisionProfile(userId, fullName, departmentId);
  done(result.error);
}

export async function setAccountStatusAction(formData: FormData): Promise<void> {
  await AuthService.requireRole(ROLES.ADMIN);
  const status = formData.get("status") === "active" ? "active" : "inactive";
  const result = await UserAdminService.setAccountStatus(String(formData.get("user_id") ?? ""), status);
  done(result.error);
}
