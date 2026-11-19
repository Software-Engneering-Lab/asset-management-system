"use client";

import { useActionState } from "react";
import { createDepartmentAction } from "./actions";
import type { FormState } from "@/lib/types";

const initial: FormState = { ok: false };

export default function DepartmentForm() {
  const [state, formAction, pending] = useActionState(createDepartmentAction, initial);
  const v = state.ok ? {} : state.values ?? {};
  const err = state.errors ?? {};

  return (
    <form action={formAction} className="grid gap-3 rounded border bg-card p-4 md:grid-cols-4">
      {state.message && (
        <p role={state.ok ? "status" : "alert"}
          className={`rounded border p-2 text-sm md:col-span-4 ${state.ok ? "border-green-300 bg-green-50 text-green-800" : "border-red-300 bg-red-50 text-red-800"}`}>
          {state.message}
        </p>
      )}
      <div>
        <label htmlFor="code" className="block text-sm font-medium">Code *</label>
        <input id="code" name="code" maxLength={20} defaultValue={v.code} key={`c-${state.message}`} className="mt-1 w-full rounded border bg-background px-3 py-2" />
        {err.code && <p className="text-sm text-red-700">{err.code}</p>}
      </div>
      <div className="md:col-span-2">
        <label htmlFor="name" className="block text-sm font-medium">Name *</label>
        <input id="name" name="name" maxLength={120} defaultValue={v.name} key={`n-${state.message}`} className="mt-1 w-full rounded border bg-background px-3 py-2" />
        {err.name && <p className="text-sm text-red-700">{err.name}</p>}
      </div>
      <div className="flex items-end">
        <button type="submit" disabled={pending} className="rounded bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60">
          {pending ? "Saving…" : "Add department"}
        </button>
      </div>
    </form>
  );
}
