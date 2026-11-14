"use client";

import { useActionState } from "react";
import { registerAssetAction } from "./actions";
import { CONDITIONS } from "@/lib/constants";
import type { AssetCategory, Department, FormState } from "@/lib/types";

interface Props {
  categories: AssetCategory[];
  departments: Department[];
  custodians: { user_id: string; full_name: string }[];
  defaultDepartmentId: string | null;
  defaultCustodianId: string;
}

const initial: FormState = { ok: false };

export default function AssetForm({ categories, departments, custodians, defaultDepartmentId, defaultCustodianId }: Props) {
  const [state, formAction, pending] = useActionState(registerAssetAction, initial);
  const v = state.values ?? {};
  const err = state.errors ?? {};

  const field = "mt-1 w-full rounded border bg-background px-3 py-2";
  const Err = ({ name }: { name: string }) =>
    err[name] ? <p className="mt-1 text-sm text-red-700">{err[name]}</p> : null;

  return (
    <form action={formAction} className="grid gap-4 rounded border bg-card p-4 md:grid-cols-2">
      {state.message && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800 md:col-span-2">
          {state.message}
        </p>
      )}

      <div className="md:col-span-2">
        <label htmlFor="name" className="block text-sm font-medium">Asset name *</label>
        <input id="name" name="name" maxLength={150} defaultValue={v.name} className={field} />
        <Err name="name" />
      </div>

      <div className="md:col-span-2">
        <label htmlFor="description" className="block text-sm font-medium">Description and specifications *</label>
        <textarea id="description" name="description" rows={3} defaultValue={v.description} className={field} />
        <Err name="description" />
      </div>

      <div>
        <label htmlFor="category_id" className="block text-sm font-medium">Category *</label>
        <select id="category_id" name="category_id" defaultValue={v.category_id ?? ""} className={field}>
          <option value="">Select…</option>
          {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
        </select>
        <Err name="category_id" />
      </div>

      <div>
        <label htmlFor="condition" className="block text-sm font-medium">Condition *</label>
        <select id="condition" name="condition" defaultValue={v.condition ?? ""} className={field}>
          <option value="">Select…</option>
          {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Err name="condition" />
      </div>

      <div>
        <label htmlFor="quantity" className="block text-sm font-medium">Quantity *</label>
        <input id="quantity" name="quantity" type="number" min={1} step={1} defaultValue={v.quantity ?? "1"} className={field} />
        <Err name="quantity" />
      </div>

      <div>
        <label htmlFor="estimated_value" className="block text-sm font-medium">Estimated value per unit (AED) *</label>
        <input id="estimated_value" name="estimated_value" type="number" min={0} step="0.01" defaultValue={v.estimated_value} className={field} />
        <Err name="estimated_value" />
      </div>

      <div>
        <label htmlFor="purchase_date" className="block text-sm font-medium">Purchase date *</label>
        <input id="purchase_date" name="purchase_date" type="date" defaultValue={v.purchase_date} className={field} />
        <Err name="purchase_date" />
      </div>

      <div>
        <label htmlFor="owning_department_id" className="block text-sm font-medium">Owning department *</label>
        <select id="owning_department_id" name="owning_department_id"
          defaultValue={v.owning_department_id ?? defaultDepartmentId ?? ""} className={field}>
          <option value="">Select…</option>
          {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.code} – {d.name}</option>)}
        </select>
        <Err name="owning_department_id" />
      </div>

      <div>
        <label htmlFor="location" className="block text-sm font-medium">Current location *</label>
        <input id="location" name="location" maxLength={150} placeholder="e.g. Building A, Room 1102" defaultValue={v.location} className={field} />
        <Err name="location" />
      </div>

      <div>
        <label htmlFor="custodian_id" className="block text-sm font-medium">Responsible custodian</label>
        <select id="custodian_id" name="custodian_id" defaultValue={v.custodian_id ?? defaultCustodianId} className={field}>
          {custodians.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
        </select>
      </div>

      <fieldset className="grid gap-4 border-t pt-4 md:col-span-2 md:grid-cols-3">
        <legend className="text-sm text-muted-foreground">Optional – used for sustainability calculations</legend>
        <div>
          <label htmlFor="material_type" className="block text-sm font-medium">Material type</label>
          <input id="material_type" name="material_type" maxLength={60} defaultValue={v.material_type} className={field} />
        </div>
        <div>
          <label htmlFor="weight_kg" className="block text-sm font-medium">Weight per unit (kg)</label>
          <input id="weight_kg" name="weight_kg" type="number" min={0} step="0.01" defaultValue={v.weight_kg} className={field} />
          <Err name="weight_kg" />
        </div>
        <div>
          <label htmlFor="expected_end_of_life" className="block text-sm font-medium">Expected end of life</label>
          <input id="expected_end_of_life" name="expected_end_of_life" type="date" defaultValue={v.expected_end_of_life} className={field} />
        </div>
      </fieldset>

      <div className="md:col-span-2">
        <button type="submit" disabled={pending}
          className="rounded bg-primary px-4 py-2 font-medium text-primary-foreground disabled:opacity-60">
          {pending ? "Saving…" : "Register asset"}
        </button>
        <span className="ml-3 text-sm text-muted-foreground">* required. The asset is saved as Registered (not published).</span>
      </div>
    </form>
  );
}
