"use client";

import Link from "next/link";

// Shown when a page fails to load data (permission, connection or database-setup problem).
// It replaces misleading "No assets" / "Not found" screens (integration review finding 5).
export default function LoadError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto mt-24 max-w-md space-y-3 p-4 text-center">
      <h1 className="text-xl font-semibold">Could not load this page</h1>
      <p className="text-muted-foreground">
        The data could not be read. This is usually a connection problem, a missing permission,
        or a database migration that has not been applied yet.
      </p>
      {error.digest && <p className="text-xs text-muted-foreground">Error reference: {error.digest}</p>}
      <div className="flex justify-center gap-2">
        <button type="button" onClick={reset} className="rounded bg-primary px-4 py-2 text-primary-foreground">
          Try again
        </button>
        <Link href="/" className="rounded border px-4 py-2">Go to home</Link>
      </div>
    </main>
  );
}
