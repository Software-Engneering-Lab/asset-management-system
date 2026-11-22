"use client";

import ActionForm, { field, button } from "./ActionForm";
import type { Person, Transfer } from "./types";

export default function TransferCard({ transfer: t, people, userId }: { transfer: Transfer; people: Person[]; userId: string }) {
  const beforeRelease = ["Approved", "Scheduled"].includes(t.transfer_status);
  const receivers = people.filter(p => p.department_id === t.receiving_department_id && p.roles?.includes("requester") && p.user_id !== userId);
  const custodians = people.filter(p => p.department_id === t.receiving_department_id && p.roles?.includes("custodian"));
  return <article className="space-y-4 rounded-lg border bg-card p-5">
    <h3 className="font-semibold">{t.asset_name} · {t.quantity} units · {t.transfer_status}</h3>
    <p>{t.sending_department} → {t.receiving_department}</p>
    <p className="break-all text-xs">Transfer: {t.transfer_id}<br />Request: {t.request_id}</p>
    <p className="text-sm">From: {t.origin_location || "Not recorded"} · To: {t.destination_location || "Not arranged"}</p>
    <p className="text-sm">Receiver: {t.receiver || "Not assigned"} · Receiving custodian: {t.custodian || "Not assigned"}</p>
    {beforeRelease && <p className="text-sm">Hold expires: {new Date(t.expires_at).toUTCString()}</p>}
    {t.collection_date && <p className="text-sm">Collection date: {t.collection_date} · Cost: AED {t.transfer_cost ?? 0}</p>}
    {t.arrangement_notes && <p className="whitespace-pre-wrap text-sm">{t.arrangement_notes}</p>}
    {t.document_reference && <p className="text-sm">Document reference: {t.document_reference}</p>}
    {beforeRelease && t.can_send && <details open={t.transfer_status === "Approved"}>
      <summary className="cursor-pointer font-medium">Arrange collection</summary>
      <ActionForm id={t.transfer_id} operation="schedule">
        <label className="block">Collection date (UTC)<input name="date" type="date" required defaultValue={t.collection_date ?? ""} className={field} /></label>
        <label className="block">Destination<input name="location" required maxLength={150} defaultValue={t.destination_location ?? ""} className={field} /></label>
        <label className="block">Receiving representative<select name="receiver" required defaultValue={t.expected_receiver_id ?? ""} className={field}>
          <option value="">Choose a receiver</option>{receivers.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </select></label>
        <label className="block">Receiving custodian<select name="custodian" required defaultValue={t.receiving_custodian_id ?? ""} className={field}>
          <option value="">Choose a custodian</option>{custodians.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}
        </select></label>
        {!custodians.length && <p role="status">An admin must assign an active custodian to the receiving department before collection can be arranged.</p>}
        <label className="block">Collection arrangements<textarea name="notes" required maxLength={2000} defaultValue={t.arrangement_notes ?? ""} className={field} /></label>
        <label className="block">Transfer cost (AED)<input name="cost" required type="number" min="0" step="0.01" defaultValue={t.transfer_cost ?? 0} className={field} /></label>
        <label className="block">Document reference (optional)<input name="document" maxLength={1000} defaultValue={t.document_reference ?? ""} className={field} /></label>
        <button type="submit" className={button}>Save arrangements</button>
      </ActionForm>
    </details>}
    {t.transfer_status === "Scheduled" && t.can_send && <ActionForm id={t.transfer_id} operation="release">
      <label className="block"><input type="checkbox" name="confirmed" required /> I confirm the approved units have been physically handed over.</label>
      <button type="submit" className={button}>Record handover</button>
    </ActionForm>}
    {beforeRelease && t.can_approve && <details>
      <summary className="cursor-pointer font-medium">Cancel or release an expired hold</summary>
      {/* Separate forms keep cancellation and expiry explicit. Neither is allowed after handover. */}
      <ActionForm id={t.transfer_id} operation="cancel">
        <label className="block">Cancellation reason<textarea name="reason" required maxLength={1000} className={field} /></label>
        <button type="submit" className={button}>Cancel transfer and request</button>
      </ActionForm>
      <ActionForm id={t.transfer_id} operation="expire">
        <label className="block">Expiry release reason<textarea name="reason" required maxLength={1000} className={field} /></label>
        <button type="submit" className={button}>Release expired hold</button>
      </ActionForm>
    </details>}
    {t.discrepancies.map(d => <section key={d.discrepancy_id} className="space-y-2 rounded border p-3 text-sm">
      <h4 className="font-semibold">Receipt discrepancy</h4><p>{d.description}</p>
      <p>{d.reporter} · {new Date(d.reported_at).toUTCString()}</p>
      {d.resolved_at ? <p>Resolved by {d.resolver} · {new Date(d.resolved_at).toUTCString()}: {d.resolution}</p> : <>
        <p>Awaiting resolution</p>
        {t.can_approve && <ActionForm id={d.discrepancy_id} operation="resolve">
          <label className="block">What was done to resolve this?<textarea name="reason" required maxLength={2000} className={field} /></label>
          <button type="submit" className={button}>Record resolution</button>
        </ActionForm>}
      </>}
    </section>)}
    {["Released", "Receipt Discrepancy"].includes(t.transfer_status) && t.can_receive && <ActionForm id={t.transfer_id} operation="receive">
      <h4 className="font-semibold">Confirm receipt</h4>
      <p className="text-sm">Enter the total units received so far, not an additional delivery quantity. Partial receipt or changed condition/location is recorded as a discrepancy.</p>
      <label className="block">Total received quantity<input name="quantity" required type="number" min={0} max={t.quantity} step={1} className={field} /></label>
      <label className="block">Actual condition<select name="condition" required defaultValue="" className={field}>
        <option value="">Choose the actual condition</option><option>Good</option><option>Fair</option><option>Poor</option>
      </select></label>
      <label className="block">Actual destination<input name="location" required maxLength={150} defaultValue={t.destination_location ?? ""} className={field} /></label>
      <label className="block"><input type="checkbox" name="problem" /> There is a discrepancy or another problem</label>
      <label className="block">Problem details (required for discrepancies)<textarea name="reason" maxLength={2000} className={field} /></label>
      <button type="submit" className={button}>Submit receipt confirmation</button>
    </ActionForm>}
    {t.received_asset_id && <p className="break-all text-sm">Received asset: {t.received_asset_id}. The receiving custodian can find it in their department&apos;s assets.</p>}
    <details><summary className="cursor-pointer font-medium">Transfer history</summary>
      <ol className="mt-2 space-y-2 text-sm">{t.history.map((h, i) => <li key={i}>
        {h.action.replaceAll("_", " ")} · {h.actor} · {new Date(h.at).toUTCString()}<p>{h.reason}</p>
      </li>)}</ol>
    </details>
  </article>;
}

