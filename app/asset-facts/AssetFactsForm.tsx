"use client";

import { useActionState } from "react";
import { saveAssetFacts, type FactsState } from "./actions";

type AssetOption = {
  asset_id: string;
  name: string;
  description: string;
  condition: string;
  department_id: string;
  facts_current: boolean;
};

const field = "w-full rounded border bg-background px-3 py-2";
const initial: FactsState = { ok: false, message: "" };

export default function AssetFactsForm({ assets }: { assets: AssetOption[] }) {
  const [state, action, pending] = useActionState(saveAssetFacts, initial);
  return (
    <form action={action} className="max-w-2xl space-y-4 rounded border p-4">
      <label className="block">Asset
        <select className={field} name="asset_id" required defaultValue="">
          <option value="">Choose an asset</option>
          {assets.map(a => <option key={a.asset_id} value={a.asset_id}>
            {a.name} ({a.condition}; {a.facts_current ? "verified facts current" : "facts missing/stale"})
          </option>)}
        </select>
      </label>
      <p className="text-sm">Use the asset or its documentation to record facts once. Do not copy requested values unless verified. Updating the asset description will require re-verification.</p>
      <label className="block">Actual item type
        <input className={field} name="item_type" required maxLength={80} placeholder="monitor, printer, keyboard" />
      </label>
      <label className="block">Additional verified specifications (optional JSON)
        <textarea className={field} name="extra_specs" rows={3} placeholder={'{"screen_size_inch":24,"hdmi":true}'} />
      </label>
      <label className="block">Safety status
        <select className={field} name="safety" required defaultValue="unknown">
          <option value="unknown">Unknown (not eligible)</option>
          <option value="restricted">Restricted (not eligible)</option>
          <option value="clear">Clear (verified)</option>
        </select>
      </label>
      <label className="block">Inspection required?
        <select className={field} name="inspection_required" defaultValue="no">
          <option value="no">No</option><option value="yes">Yes</option>
        </select>
      </label>
      <label className="block">Inspection result (when required)
        <select className={field} name="inspection_result" defaultValue="unknown">
          <option value="unknown">Unknown</option><option value="failed">Failed</option><option value="passed">Passed</option>
        </select>
      </label>
      <label className="block">Inspection date (if passed)
        <input className={field} type="date" name="inspected_on" />
      </label>
      <label className="block">Inspection valid until (if passed)
        <input className={field} type="date" name="inspection_until" />
      </label>
      <label className="block">Earliest verified arrival to ANY requesting department (optional; campus-wide guarantee only)
        <input className={field} type="date" name="earliest_receipt" />
      </label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="campus_wide_confirmed" />
        If I enter an arrival date, I confirm it is supported by evidence for delivery to every requesting department, not just stock availability or one destination.
      </label>
      <label className="block">Facts valid through (maximum 30 days)
        <input className={field} type="date" name="valid_until" required />
      </label>
      <label className="block">Evidence source / inspection reference
        <textarea className={field} name="source" required maxLength={1000} rows={2} />
      </label>
      <button className="rounded bg-blue-950 px-4 py-2 text-white disabled:opacity-50" disabled={pending} type="submit">
        {pending ? "Saving..." : "Save verified asset facts"}
      </button>
      {state.message && <p role={state.ok ? "status" : "alert"} className="rounded border p-2">{state.message}</p>}
    </form>
  );
}
