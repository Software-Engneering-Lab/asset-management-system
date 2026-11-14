"use client";

import { useActionState } from "react";
import { submitApprovalAction } from "./actions";
import type { ApprovalRequest, ApprovalFormState } from "@/lib/approvals/types";

const initialState: ApprovalFormState = { ok: false, message: "" };
const field = "w-full rounded border bg-background p-2 text-sm";
const button = "rounded bg-blue-950 px-3 py-2 text-sm text-white disabled:opacity-50";

export default function ApprovalCard({ request, userId }: { request: ApprovalRequest; userId: string }) {
  const [result, action, pending] = useActionState(submitApprovalAction, initialState);
  const ownRequest = request.submitted_by === userId;
  const status = request.request_status;
  const id = request.request_id;

  return (
    <article className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap justify-between gap-2">
        <h2 className="font-semibold">{request.category} — {request.quantity} units</h2>
        <span className="rounded bg-muted px-2 py-1 text-sm">{status}</span>
      </div>
      <p className="text-sm">{request.requester} · {request.department} · Urgency: {request.urgency}</p>
      <p className="break-all text-xs text-muted-foreground">Request: {id}</p>
      <dl className="space-y-2 text-sm">
        <div><dt className="font-medium">Specifications</dt><dd className="whitespace-pre-wrap">{request.specifications}</dd></div>
        <div><dt className="font-medium">Purpose</dt><dd>{request.purpose}</dd></div>
        <div><dt className="font-medium">Minimum preferred condition</dt><dd>{request.preferred_condition || "Not specified"}</dd></div>
      </dl>
      {request.accepted_matches.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Requester-accepted AI suggestions (including earlier runs)</summary>
          <ul className="mt-2 space-y-2">
            {request.accepted_matches.map((match, index) => <li key={`${match.asset_id}-${index}`}>
              {match.asset_id} · Score {match.score}/100 · {match.explanation}
            </li>)}
          </ul>
          <p className="mt-2">Suggestions do not approve or reserve stock. Check current eligibility below.</p>
        </details>
      )}
      {request.latest_approval && <p className="text-sm">Decision reason: {request.latest_approval.reason}</p>}
      {request.reservation && <p className="text-sm">Held: {request.reservation.reserved_quantity} units. Expires: {new Date(request.reservation.expires_at).toUTCString()}</p>}
      {ownRequest ? <p role="status" className="text-sm font-medium">Another approver must handle your own request.</p> : (
        <form action={action} className="space-y-3">
          <input type="hidden" name="request_id" value={id} />
          <fieldset disabled={pending} className="space-y-3">
            <legend className="sr-only">Actions for request {id}</legend>
            {status === "Submitted" && <button name="operation" value="review" className={button}>Start review</button>}
            {status === "Under Review" && <>
              <label htmlFor={`asset-${id}`} className="block text-sm font-medium">Asset for approval</label>
              <select id={`asset-${id}`} name="asset_id" className={field} defaultValue="">
                <option value="">Select an eligible asset</option>
                {request.assets.map(asset => <option key={asset.asset_id} value={asset.asset_id}>{asset.name} — {asset.condition} — {asset.available_quantity} available</option>)}
              </select>
              {request.assets.length === 0 && <p className="text-sm">No eligible stock currently meets this request. You can still reject it with a reason.</p>}
            </>}
            {(status === "Under Review" || status === "Approved" || status === "Reserved") && <>
              <label htmlFor={`reason-${id}`} className="block text-sm font-medium">Reason (required for decisions and ending a hold)</label>
              <textarea id={`reason-${id}`} name="reason" maxLength={1000} rows={2} className={field} />
            </>}
            {status === "Under Review" && <div className="flex flex-wrap gap-2">
              <button name="operation" value="approve" disabled={!request.assets.length} className={button}>Approve and reserve</button>
              <button name="operation" value="reject" className={button}>Reject</button>
              {/* Return-for-information RPC exists; expose the button after requester resubmission is implemented. */}
            </div>}
            {(status === "Approved" || status === "Under Review") && <>
              <label htmlFor={`hours-${id}`} className="block text-sm font-medium">Reservation duration in hours (1–168)</label>
              <input id={`hours-${id}`} name="expiry_hours" type="number" min={1} max={168} defaultValue={24} className={field} />
              <p className="text-xs text-muted-foreground">24 hours is an editable prototype default. Availability is checked again when reserving.</p>
              {status === "Approved" && <button name="operation" value="reserve" className={button}>Reserve approved asset</button>}
            </>}
            {(status === "Approved" || status === "Reserved") && <div className="flex flex-wrap gap-2">
              <button name="operation" value="cancel" className={button}>Cancel request and release hold</button>
              {status === "Reserved" && <button name="operation" value="expire" className={button}>Release expired hold</button>}
            </div>}
          </fieldset>
          {pending && <p role="status" className="text-sm">Saving…</p>}
          {result.message && <p role={result.ok ? "status" : "alert"} className="rounded border p-2 text-sm">{result.message}</p>}
        </form>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer font-medium">Request history</summary>
        <ol className="mt-2 space-y-2">
          {request.history.map((event, index) => <li key={index}>
            <strong>{event.to_status}</strong> · {event.actor} · {new Date(event.changed_at).toUTCString()}
            {event.reason && <p>{event.reason}</p>}
          </li>)}
        </ol>
      </details>
    </article>
  );
}
