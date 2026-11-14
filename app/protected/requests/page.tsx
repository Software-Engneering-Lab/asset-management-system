"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  loadRequestWorkspace,
  submitRequest,
  type RequestWorkspace,
} from "./actions";

export default function RequestsPage() {
  const [workspace, setWorkspace] = useState<RequestWorkspace | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const submitting = useRef(false);

  const fieldClass =
    "w-full rounded-md border border-input bg-background px-3 py-2";

  async function refreshRequests() {
    setLoading(true);
    setError("");

    try {
      const result = await loadRequestWorkspace();

      if (result.success) {
        setWorkspace(result.data);
      } else {
        setWorkspace(null);
        setError(result.message);
      }
    } catch {
      setWorkspace(null);
      setError("Unable to load requests. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshRequests();
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitting.current || !workspace || loading) return;

    submitting.current = true;
    setSaving(true);
    setError("");
    setMessage("");

    const form = event.currentTarget;
    const data = new FormData(form);

    try {
      const result = await submitRequest(data);

      if (!result.success) {
        setError(result.message);
        return;
      }

      form.reset();
      setMessage(`Request saved successfully. Reference: ${result.requestId}`);
      await refreshRequests();
    } catch {
      setError(
        "Submission could not be confirmed. Refresh your list before trying again.",
      );
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  function displayDate(value: string) {
    return new Date(value).toLocaleString();
  }

  return (
    <section className="w-full space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My Resource Requests</h1>
          <p className="mt-2 text-muted-foreground">
            Submit requests and track their progress.
          </p>
          {workspace && (
            <p className="mt-2 text-sm">
              Department: {workspace.department_name}
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={() => void refreshRequests()}
          disabled={loading || saving}
          className="rounded-md border px-4 py-2 disabled:opacity-50"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-md border border-red-500 p-4">
          {error}
        </div>
      )}

      <p role="status" className="break-words text-sm">
        {message}
      </p>

      {loading && !workspace && (
        <p role="status">Loading your request workspace…</p>
      )}

      {!loading && !workspace && (
        <div className="rounded-lg border p-6">
          <h2 className="font-semibold">Request workspace unavailable</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Submission is disabled until your account setup and the reviewed
            request migrations are ready. No sample requests are being shown.
          </p>
        </div>
      )}

      {workspace && (
        <>
          <section className="rounded-lg border p-6">
            <h2 className="mb-5 text-xl font-semibold">Submit a request</h2>

            {workspace.categories.length === 0 && (
              <p className="mb-4 text-sm">
                No categories are available. Ask the team to check the shared
                category records.
              </p>
            )}

            <form onSubmit={handleSubmit}>
              <fieldset
                disabled={
                  saving || loading || workspace.categories.length === 0
                }
                className="space-y-4 disabled:opacity-60"
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="block">Category *</span>
                    <select
                      name="category"
                      required
                      defaultValue=""
                      className={fieldClass}
                    >
                      <option value="">Select a category</option>
                      {workspace.categories.map((category) => (
                        <option
                          key={category.category_id}
                          value={category.name}
                        >
                          {category.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-2">
                    <span className="block">Quantity *</span>
                    <input
                      name="quantity"
                      type="number"
                      min="1"
                      max="2147483647"
                      step="1"
                      defaultValue="1"
                      required
                      className={fieldClass}
                    />
                  </label>
                </div>

                <label className="block space-y-2">
                  <span className="block">Specifications *</span>
                  <textarea
                    name="specifications"
                    placeholder="Describe the resources you need"
                    required
                    maxLength={5000}
                    rows={3}
                    className={fieldClass}
                  />
                </label>

                <label className="block space-y-2">
                  <span className="block">Purpose *</span>
                  <textarea
                    name="purpose"
                    placeholder="Explain why the resources are needed"
                    required
                    maxLength={5000}
                    rows={2}
                    className={fieldClass}
                  />
                </label>

                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block space-y-2">
                    <span className="block">Preferred condition</span>
                    <select
                      name="preferred_condition"
                      defaultValue=""
                      className={fieldClass}
                    >
                      <option value="">No preference</option>
                      <option>Good</option>
                      <option>Fair</option>
                      <option>Poor</option>
                    </select>
                  </label>

                  <label className="block space-y-2">
                    <span className="block">Urgency *</span>
                    <select
                      name="urgency"
                      defaultValue="Normal"
                      required
                      className={fieldClass}
                    >
                      <option>Low</option>
                      <option>Normal</option>
                      <option>High</option>
                    </select>
                  </label>

                  <label className="block space-y-2">
                    <span className="block">Preferred location</span>
                    <input
                      name="preferred_location"
                      maxLength={150}
                      className={fieldClass}
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="block">Required date</span>
                    <input
                      name="required_date"
                      type="date"
                      className={fieldClass}
                    />
                  </label>
                </div>

                <button
                  type="submit"
                  className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
                >
                  {saving ? "Submitting…" : "Submit request"}
                </button>
              </fieldset>
            </form>
          </section>

          <section className="rounded-lg border p-6">
            <h2 className="text-xl font-semibold">Request tracking</h2>
            <p className="mb-4 mt-1 text-sm text-muted-foreground">
              Your latest 100 requests. Refresh to check for status changes.
            </p>

            {workspace.requests.length === 0 ? (
              <p>You have not submitted any requests yet.</p>
            ) : (
              <ul className="space-y-4">
                {workspace.requests.map((request) => (
                  <li
                    key={request.request_id}
                    className="rounded-md border p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-semibold">{request.category}</h3>
                      <span className="rounded-full bg-muted px-3 py-1 text-sm">
                        {request.request_status}
                      </span>
                    </div>

                    <p className="mt-3 whitespace-pre-wrap">
                      {request.specifications}
                    </p>

                    <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                      <div>
                        <dt className="font-medium">Quantity</dt>
                        <dd>{request.quantity}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">Urgency</dt>
                        <dd>{request.urgency}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">Preferred condition</dt>
                        <dd>{request.preferred_condition || "No preference"}</dd>
                      </div>
                      <div>
                        <dt className="font-medium">Required date</dt>
                        <dd>{request.required_date || "Not specified"}</dd>
                      </div>
                    </dl>

                    <p className="mt-3 whitespace-pre-wrap text-sm">
                      Purpose: {request.purpose}
                    </p>
                    <p className="mt-1 text-sm">
                      Preferred location:{" "}
                      {request.preferred_location || "Not specified"}
                    </p>
                    <p className="mt-2 break-all text-xs text-muted-foreground">
                      Reference: {request.request_id}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created: {displayDate(request.created_at)}
                    </p>

                    <details className="mt-4">
                      <summary className="cursor-pointer font-medium">
                        Status history
                      </summary>

                      {request.history.length === 0 ? (
                        <p className="mt-2 text-sm">No history recorded.</p>
                      ) : (
                        <ol className="mt-3 space-y-3 border-l pl-4">
                          {request.history.map((entry) => (
                            <li key={entry.history_id} className="text-sm">
                              <p className="font-medium">
                                {entry.from_status
                                  ? `${entry.from_status} → ${entry.to_status}`
                                  : entry.to_status}
                              </p>
                              <p className="text-muted-foreground">
                                {displayDate(entry.changed_at)}
                              </p>
                              {entry.reason && (
                                <p className="whitespace-pre-wrap">
                                  {entry.reason}
                                </p>
                              )}
                            </li>
                          ))}
                        </ol>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </section>
  );
}