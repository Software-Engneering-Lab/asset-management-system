"use server";

import { revalidatePath } from "next/cache";
import { AuthService } from "@/lib/auth/AuthService";
import { DepartmentService } from "@/lib/services/DepartmentService";
import { ROLES } from "@/lib/constants";
import type { FormState } from "@/lib/types";

export async function createDepartmentAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await AuthService.requireRole(ROLES.ADMIN);

  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim();
  const errors: Record<string, string> = {};
  if (!code) errors.code = "Code is required.";
  else if (code.length > 20) errors.code = "Code must be 20 characters or fewer.";
  if (!name) errors.name = "Name is required.";
  else if (name.length > 120) errors.name = "Name must be 120 characters or fewer.";
  if (Object.keys(errors).length) return { ok: false, errors, values: { code, name } };

  const result = await DepartmentService.create(code, name);
  if (result.error) return { ok: false, message: result.error, values: { code, name } };

  revalidatePath("/admin/departments");
  return { ok: true, message: `Department ${code} created.` };
}

export async function toggleDepartmentAction(formData: FormData): Promise<void> {
  await AuthService.requireRole(ROLES.ADMIN);
  const id = String(formData.get("department_id") ?? "");
  const makeActive = formData.get("make_active") === "true";
  await DepartmentService.setActive(id, makeActive);
  revalidatePath("/admin/departments");
}
