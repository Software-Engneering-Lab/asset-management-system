"use server";

import { redirect } from "next/navigation";
import { AuthService } from "@/lib/auth/AuthService";
import type { FormState } from "@/lib/types";

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { ok: false, message: "Enter your email and password.", values: { email } };
  }

  const result = await AuthService.signIn(email, password);
  if (!result.ok) return { ok: false, message: result.message, values: { email } };

  redirect("/assets");
}

export async function signOutAction(): Promise<void> {
  await AuthService.signOut();
  redirect("/auth/login");
}
