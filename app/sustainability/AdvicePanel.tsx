"use client";

import { useState } from "react";
import {
  getSustainabilityAdvice,
  saveSustainabilityPlan,
  type AdviceResult,
} from "./actions";

type AssetOption = {
  id: string;
  name: string;
  condition: string;
  state: string;
};

const field = "w-full rounded border bg-background p-2";
const button =
  "rounded bg-blue-950 px-3 py-2 text-white disabled:opacity-50";

export default function AdvicePanel({
  assets,
}: {
  assets: AssetOption[];
}) {
  const [assetId, setAssetId] = useState("");
  const [result, setResult] = useState<AdviceResult | null>(null);
  const [choice, setChoice] = useState("defer");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function generate() {
    setBusy(true);
    setMessage("");
    setResult(null);

    try {
      setResult(await getSustainabilityAdvice(assetId));
    } catch {
      setMessage("Unable to load advice. No action was taken.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setMessage("");

    try {
      const response = await saveSustainabilityPlan(
        assetId,
        choice,
        reason,
      );

      setMessage(response.message);
      if (response.ok) setReason("");
    } catch {
      setMessage(
        "Save could not be confirmed. Refresh and check review history before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded border p-4">
      <h2 className="text-xl font-semibold">
        Sustainable-action advice
      </h2>

      <p className="text-sm">
        AI offers options. A staff member decides the plan.
        Recording a plan does not approve a transfer, donation,
        recycling or disposal.
      </p>

      <label className="block">
        Asset
        <select
          className={field}
          value={assetId}
          disabled={busy}
          onChange={(event) => {
            setAssetId(event.target.value);
            setResult(null);
            setMessage("");
            setChoice("defer");
            setReason("");
          }}
        >
          <option value="">Choose an asset</option>
          {assets.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name} — {asset.condition} — {asset.state}
            </option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={button}
        disabled={!assetId || busy}
        onClick={generate}
      >
        {busy ? "Working…" : "Generate AI advice"}
      </button>

      {result && (
        <div className="space-y-3 rounded border p-3">
          <p role="status">{result.message}</p>

          <p className="text-sm">
            Recorded available mass:{" "}
            {result.availableMassKg == null
              ? "Not calculable: unit weight is missing."
              : `${result.availableMassKg.toLocaleString()} kg`}
          </p>

          <p className="text-xs">
            Formula: available quantity × recorded unit weight.
            Source: asset record. This is not calculated waste
            diversion or carbon reduction.
          </p>

          {result.model && (
            <p className="text-xs">Model: {result.model}</p>
          )}

          <ul className="space-y-2">
            {result.suggestions?.map((suggestion) => (
              <li key={suggestion.action}>
                <strong className="capitalize">
                  {suggestion.action}
                </strong>
                : {suggestion.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      <fieldset disabled={!assetId || busy} className="space-y-3">
        <legend className="font-semibold">Your reviewed plan</legend>

        <label className="block">
          Choose a plan or defer the decision
          <select
            className={field}
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="defer">Defer / needs more information</option>
            <option value="reuse">Reuse</option>
            <option value="repair">Repair</option>
            <option value="donation">Donation</option>
            <option value="recycling">Recycling</option>
            <option value="disposal">Disposal</option>
          </select>
        </label>

        <label className="block">
          Your reason and any required checks
          <textarea
            className={field}
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        <button
          type="button"
          className={button}
          disabled={!reason.trim() || busy}
          onClick={save}
        >
          Save human review
        </button>
      </fieldset>

      {message && <p role="status">{message}</p>}
    </section>
  );
}