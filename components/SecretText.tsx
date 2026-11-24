"use client";

import { useState } from "react";

/**
 * Shows a secret as •••••••• with Show/Hide and Copy buttons.
 * Used on Users & roles to show a NEW temporary password to the admin once.
 * (A user's real password can never be shown: Supabase stores only a one-way hash.)
 */
export default function SecretText({ value, label }: { value: string; label: string }) {
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setVisible(true); // clipboard blocked: show it so it can be copied by hand
    }
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code aria-label={label} className="rounded bg-white px-2 py-1 font-mono text-base text-black">
        {visible ? value : "••••••••"}
      </code>
      <button type="button" onClick={() => setVisible((v) => !v)} className="rounded border bg-background px-2 py-1 text-xs">
        {visible ? "Hide" : "Show"}
      </button>
      <button type="button" onClick={copy} className="rounded border bg-background px-2 py-1 text-xs">
        {copied ? "Copied ✓" : "Copy"}
      </button>
    </span>
  );
}
