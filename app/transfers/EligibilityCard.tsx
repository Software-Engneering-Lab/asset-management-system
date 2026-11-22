"use client";

import ActionForm, { field, button } from "./ActionForm";
import type { EligibilityCheck, Rule } from "./types";

export default function EligibilityCard({ check: q }: { check: EligibilityCheck }) {
  const itemType = q.mandatory.find(r => r.field === "item_type");
  // One input per actual asset fact, even if a field has multiple requested limits.
  const rules = new Map<string, Rule>();
  for (const rule of [...q.mandatory, ...q.preferred]) rules.set(rule.field, rule);
  if (!rules.has("item_type")) rules.set("item_type", { field: "item_type", operator: "eq", value: "" });
  return <article className="space-y-3 rounded border p-4">
    <h3 className="font-semibold">{q.specifications}</h3>
    <p className="text-sm">{q.quantity} units · {q.status} · Required date: {q.required_date || "Not specified"}</p>
    <p className="break-all text-xs">Request: {q.request_id}</p>
    {q.can_confirm && <ActionForm id={q.request_id} operation="item_type">
      <label className="block">Requested item type (for example, monitor or keyboard)
        <input name="item_type" required maxLength={80} defaultValue={typeof itemType?.value === "string" ? itemType.value : ""} className={field} />
      </label>
      <p className="text-sm">Use a specific item type consistent with your written request. This keeps your other confirmed requirements.</p>
      <button type="submit" className={button}>Confirm item type</button>
    </ActionForm>}
    {q.mandatory.length > 0 && <div className="text-sm"><strong>Mandatory requirements</strong>
      <ul className="list-inside list-disc">{q.mandatory.map((r, i) => <li key={i}>{r.field}: {r.operator} {String(r.value)}</li>)}</ul>
    </div>}
    {q.assets.map(a => <details key={a.asset_id} className="rounded border p-3">
      <summary className="cursor-pointer font-medium">Verify {a.name} · {a.problem ? "Needs review / not eligible" : "Eligible"}</summary>
      <p className="my-2 text-sm">{a.description} · {a.condition} · {a.location}</p>
      {a.problem && <p className="my-2 text-sm">{a.problem}</p>}
      <ActionForm id={q.request_id} operation="verify">
        <input type="hidden" name="asset" value={a.asset_id} />
        <p className="text-sm">Record actual facts from the asset or its documentation. Do not enter requested values unless the asset really meets them. Leave unknown optional facts empty.</p>
        {[...rules.values()].map(rule => <label key={rule.field} className="block">Actual {rule.field.replaceAll("_", " ")}
          {typeof rule.value === "boolean" ? <select name={`spec:${rule.field}:boolean`} defaultValue="" className={field}>
            <option value="">Unknown</option><option value="true">Yes</option><option value="false">No</option>
          </select> : <input name={`spec:${rule.field}:${typeof rule.value}`} type={typeof rule.value === "number" ? "number" : "text"}
            step={typeof rule.value === "number" ? "any" : undefined} maxLength={500} required={rule.field === "item_type"} className={field} />}
        </label>)}
        <label className="block">Safety status<select name="safety" defaultValue="" required className={field}>
          <option value="">Choose verified status</option><option value="clear">Clear</option><option value="restricted">Restricted</option><option value="unknown">Unknown</option>
        </select></label>
        <label className="block">Is an inspection required?<select name="inspection" defaultValue="" required className={field}>
          <option value="">Choose</option><option value="yes">Yes — passed inspection documented below</option><option value="no">No</option>
        </select></label>
        <label className="block">Passed inspection date (if required)<input name="inspected_on" type="date" className={field} /></label>
        <label className="block">Inspection valid through (if required)<input name="inspection_until" type="date" className={field} /></label>
        <label className="block">Earliest receipt date (required if request has a deadline)<input name="receipt_date" type="date" required={!!q.required_date} className={field} /></label>
        <label className="block">These facts are valid through (within 30 days, UTC)<input name="valid_until" type="date" required className={field} /></label>
        <label className="block">Evidence source or inspection reference<textarea name="source" required maxLength={1000} className={field} /></label>
        <label className="block"><input type="checkbox" name="verified" required /> I confirm this asset meets the full written specifications and the facts above are accurate.</label>
        <button type="submit" className={button}>Save verified facts</button>
      </ActionForm>
    </details>)}
  </article>;
}
