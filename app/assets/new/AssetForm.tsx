"use client";

import { useActionState, useState, useTransition } from "react";
import { registerAssetAction } from "./actions";
import { suggestClassificationAction, type SuggestResult } from "./ai1-actions";
import { CONDITIONS } from "@/lib/constants";
import type { AssetCategory, Department, FormState } from "@/lib/types";

interface Props {
  categories: AssetCategory[];
  departments: Department[];
  custodians: { user_id: string; full_name: string; department_id: string }[];
  defaultDepartmentId: string | null;
  defaultCustodianId: string;
}

const initial: FormState = { ok: false };

export default function AssetForm({ categories, departments, custodians, defaultDepartmentId, defaultCustodianId }: Props) {
  const [state, formAction, pending] = useActionState(registerAssetAction, initial);
  const v = state.values ?? {};
  const err = state.errors ?? {};
  // Only custodians of the chosen department can be responsible for the asset
  const [departmentId, setDepartmentId] = useState(v.owning_department_id ?? defaultDepartmentId ?? "");
  const deptCustodians = custodians.filter((u) => u.department_id === departmentId);
  const preferred = v.custodian_id ?? defaultCustodianId;
  const custodianDefault = deptCustodians.some((u) => u.user_id === preferred) ? preferred : "";

  // AI 1 - Classification and tagging: suggestions only; the custodian accepts or edits each field.
  const [name, setName] = useState(v.name ?? "");
  const [description, setDescription] = useState(v.description ?? "");
  const [categoryId, setCategoryId] = useState(v.category_id ?? "");
  const [condition, setCondition] = useState(v.condition ?? "");
  const [tags, setTags] = useState(v.tags ?? "");
  const [ai, setAi] = useState<SuggestResult | null>(null);
  const [asking, startAsking] = useTransition();
  const suggestion = ai?.ok ? ai.suggestion : null;
  const categoryName = (id: string | null) => categories.find((c) => c.category_id === id)?.name ?? "—";
  const askAi = () => startAsking(async () => setAi(await suggestClassificationAction(name, description)));

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
        <input id="name" name="name" maxLength={150} value={name} onChange={(e) => setName(e.target.value)} className={field} />
        <Err name="name" />
      </div>

      <div className="md:col-span-2">
        <label htmlFor="description" className="block text-sm font-medium">Description and specifications *</label>
        <textarea id="description" name="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={field} />
        <Err name="description" />
      </div>

      <section aria-label="AI 1 suggestions" className="space-y-2 rounded border border-dashed p-3 md:col-span-2">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={askAi} disabled={asking}
            className="rounded border px-3 py-1.5 text-sm font-medium disabled:opacity-60">
            {asking ? "Suggesting…" : "Suggest category, condition and tags (AI 1)"}
          </button>
          <span className="text-xs text-muted-foreground">Suggestions only. Nothing changes until you accept it, and you can edit everything.</span>
        </div>
        {ai && !ai.ok && <p role="alert" className="text-sm text-red-700">{ai.message}</p>}
        {suggestion && (
          <div role="status" className="space-y-2 text-sm">
            <p className="font-medium">
              {suggestion.source === "ai" ? `AI suggestion (${suggestion.model})` : "Rule-based suggestion (AI not configured)"}
            </p>
            <p className="text-muted-foreground">{suggestion.reason}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span>Category: <strong>{categoryName(suggestion.categoryId)}</strong></span>
              {suggestion.categoryId && (
                <button type="button" className="rounded border px-2 py-0.5" onClick={() => setCategoryId(suggestion.categoryId!)}>Use</button>
              )}
              <span className="ml-3">Condition: <strong>{suggestion.condition ?? "—"}</strong></span>
              {suggestion.condition && (
                <button type="button" className="rounded border px-2 py-0.5" onClick={() => setCondition(suggestion.condition!)}>Use</button>
              )}
              <span className="ml-3">Tags: <strong>{suggestion.tags.join(", ") || "—"}</strong></span>
              {suggestion.tags.length > 0 && (
                <button type="button" className="rounded border px-2 py-0.5" onClick={() => setTags(suggestion.tags.join(", "))}>Use</button>
              )}
            </div>
          </div>
        )}
        <input type="hidden" name="ai_suggestion" value={suggestion ? JSON.stringify(suggestion) : ""} />
      </section>

      <div>
        <label htmlFor="category_id" className="block text-sm font-medium">Category *</label>
        <select id="category_id" name="category_id" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field}>
          <option value="">Select…</option>
          {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
        </select>
        <Err name="category_id" />
      </div>

      <div>
        <label htmlFor="condition" className="block text-sm font-medium">Condition *</label>
        <select id="condition" name="condition" value={condition} onChange={(e) => setCondition(e.target.value)} className={field}>
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
        {departments.length === 1 ? (
          // A custodian registers for her own department only, so this is fixed.
          <>
            <input type="hidden" name="owning_department_id" value={departments[0].department_id} />
            <p id="owning_department_id" className={`${field} bg-muted`}>
              {departments[0].code} – {departments[0].name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Assets are registered for your own department.</p>
          </>
        ) : (
          <select id="owning_department_id" name="owning_department_id"
            value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={field}>
            <option value="">Select…</option>
            {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.code} – {d.name}</option>)}
          </select>
        )}
        <Err name="owning_department_id" />
      </div>

      <div>
        <label htmlFor="location" className="block text-sm font-medium">Current location *</label>
        <input id="location" name="location" maxLength={150} placeholder="e.g. Building A, Room 1102" defaultValue={v.location} className={field} />
        <Err name="location" />
      </div>

      <div>
        <label htmlFor="custodian_id" className="block text-sm font-medium">Responsible custodian *</label>
        <select id="custodian_id" name="custodian_id" key={departmentId} defaultValue={custodianDefault} required className={field}>
          {custodianDefault === "" && <option value="">Select…</option>}
          {deptCustodians.map((u) => <option key={u.user_id} value={u.user_id}>{u.full_name}</option>)}
        </select>
        <p className="mt-1 text-xs text-muted-foreground">Every asset needs a custodian. Only custodians of the owning department are listed.</p>
      </div>

      <div className="md:col-span-2">
        <label htmlFor="tags" className="block text-sm font-medium">Tags (optional, comma-separated, up to 8)</label>
        <input id="tags" name="tags" maxLength={300} placeholder="e.g. laptop, portable, 16gb-ram" value={tags}
          onChange={(e) => setTags(e.target.value)} className={field} />
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
