"use client";

import { useActionState } from "react";
import { signInAction } from "@/app/actions/auth";
import type { FormState } from "@/lib/types";

const initial: FormState = { ok: false };

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(signInAction, initial);

  return (
    <form action={formAction} className="space-y-4">
      {state.message && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          {state.message}
        </p>
      )}
      <div>
        <label htmlFor="email" className="block text-sm font-medium">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email"
          defaultValue={state.values?.email ?? ""}
          className="mt-1 w-full rounded border bg-background px-3 py-2" />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password"
          className="mt-1 w-full rounded border bg-background px-3 py-2" />
      </div>
      <button type="submit" disabled={pending}
        className="w-full rounded bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
