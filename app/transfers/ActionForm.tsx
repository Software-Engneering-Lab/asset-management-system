"use client";

import { useActionState, type ReactNode } from "react";
import { transferAction } from "./actions";

export const field = "w-full rounded border bg-background p-2 text-sm";
export const button = "rounded bg-blue-950 px-3 py-2 text-sm text-white disabled:opacity-50";

// Each form has its own pending/error state, so feedback stays next to the action.
export default function ActionForm({ id, operation, children }: { id: string; operation: string; children: ReactNode }) {
  const [result, action, pending] = useActionState(transferAction, { ok: false, message: "" });
  return <form action={action} className="space-y-2 rounded border p-3">
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="operation" value={operation} />
    <fieldset disabled={pending} className="space-y-3">{children}</fieldset>
    {pending && <p role="status">Saving…</p>}
    {result.message && <p role={result.ok ? "status" : "alert"} className="text-sm font-medium">{result.message}</p>}
  </form>;
}
