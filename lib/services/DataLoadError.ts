/**
 * Thrown when a database read fails (permission, connection or setup problem).
 * It must never look like "no data": app/error.tsx shows a load-error page with a retry button.
 */
export class DataLoadError extends Error {
  constructor(what: string, cause?: { message?: string; code?: string } | null) {
    super(`Could not load ${what}${cause?.code ? ` (code ${cause.code})` : ""}: ${cause?.message ?? "unknown error"}`);
    this.name = "DataLoadError";
  }
}

/** Throws a DataLoadError when a Supabase call returned an error. */
export function throwIfError(error: { message?: string; code?: string } | null, what: string): void {
  if (error) throw new DataLoadError(what, error);
}
