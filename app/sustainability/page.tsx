import { Suspense } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { AuthService } from "@/lib/auth/AuthService";
import { createClient } from "@/lib/supabase/server";
import AdvicePanel from "./AdvicePanel";

type Workspace = {
  scope: string;
  period: string;
  metrics: {
    completed_transfers: number;
    unit_movements: number;
    missing_received_quantities: number;
    known_transferred_mass_kg: number | null;
    missing_mass_records: number;
    recorded_transfer_cost_aed: number | null;
    missing_cost_records: number;
  };
  assets: {
    id: string;
    name: string;
    condition: string;
    state: string;
  }[];
  records: {
    transfer_id: string;
    asset_id: string;
    name: string;
    received_quantity: number | null;
    transfer_cost: number | null;
    received_at: string;
  }[];
  reviews: {
    audit_id: string;
    name: string;
    reviewer: string;
    chosen_action: string;
    reason: string;
    occurred_at: string;
  }[];
};

function number(value: number | null) {
  return value == null
    ? "Not calculable"
    : value.toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });
}

async function Dashboard() {
  const user = await AuthService.requireRole(
    "admin",
    "approver",
    "custodian",
  );

  const db = await createClient();
  const { data, error } = await db.rpc(
    "renad_sustainability_workspace",
  );

  if (error || !data) {
    return (
      <>
        <NavBar user={user} />
        <p role="alert" className="p-4">
          Sustainability data could not be loaded. Check the
          migration and your account permissions.
        </p>
      </>
    );
  }

  const workspace = data as Workspace;
  const m = workspace.metrics;

  const measures = [
    {
      name: "Completed reuse transfers",
      value: number(m.completed_transfers),
      formula:
        "Count transfers with status Completed and a receipt timestamp.",
      source: "transfer.transfer_status and transfer.received_at",
      note: "Counts transfer events, not unique physical items.",
    },
    {
      name: "Received unit movements",
      value: number(m.unit_movements),
      formula: "Sum received_quantity across completed transfers.",
      source: "transfer.received_quantity",
      note: m.missing_received_quantities
        ? `Incomplete: ${m.missing_received_quantities} records lack received quantities.`
        : "A unit transferred again counts as another movement; this is not a unique-unit reuse rate.",
    },
    {
      name: "Known transferred material mass (kg)",
      value: number(m.known_transferred_mass_kg),
      formula:
        "Sum received_quantity × recorded asset unit weight for completed transfers.",
      source: "transfer.received_quantity and asset.weight_kg",
      note: m.missing_mass_records
        ? `Incomplete: ${m.missing_mass_records} records lack quantity or weight. Shown value is the known subtotal.`
        : "Uses current recorded unit weights. Not waste diverted or carbon reduction.",
    },
    {
      name: "Recorded transfer expenditure (AED)",
      value: number(m.recorded_transfer_cost_aed),
      formula: "Sum transfer_cost across completed transfers.",
      source: "transfer.transfer_cost",
      note: m.missing_cost_records
        ? `Incomplete: ${m.missing_cost_records} transfers have no recorded cost. Shown value is the known subtotal.`
        : "Actual recorded transfer expenditure—not avoided purchase costs or savings.",
    },
  ];

  return (
    <>
      <NavBar user={user} />

      <main className="mx-auto max-w-6xl space-y-6 p-4">
        <header>
          <h1 className="text-2xl font-semibold">
            Sustainability dashboard
          </h1>
          <p>{workspace.scope} · {workspace.period}</p>
          <p className="mt-2 text-sm">
            These measures describe recorded resource circulation.
            Cancelled and incomplete transfers are excluded.
          </p>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          {measures.map((measure) => (
            <article
              key={measure.name}
              className="space-y-2 rounded border p-4"
            >
              <h2 className="font-semibold">{measure.name}</h2>
              <p className="text-3xl font-bold">{measure.value}</p>
              <p className="text-sm">Formula: {measure.formula}</p>
              <p className="text-xs">Source: {measure.source}</p>
              <p className="text-sm">{measure.note}</p>
            </article>
          ))}
        </section>

        <p className="rounded border p-3 text-sm">
          Carbon reduction, unique-unit reuse rate, avoided purchases
          and net savings are not calculated here. Those need suitable
          emission factors, unit-level tracking, purchase baselines
          or repair-cost evidence. Missing inputs are not treated as
          proven zero impact.
        </p>

        <AdvicePanel assets={workspace.assets} />

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Supporting completed transfers
          </h2>
          <p className="text-sm">
            Latest 100 visible records. Dashboard totals include all
            visible completed transfers.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th className="p-2">Asset</th>
                  <th className="p-2">Received units</th>
                  <th className="p-2">Cost (AED)</th>
                  <th className="p-2">Receipt time</th>
                  <th className="p-2">Transfer reference</th>
                </tr>
              </thead>
              <tbody>
                {workspace.records.map((record) => (
                  <tr key={record.transfer_id} className="border-t">
                    <td className="p-2">
                      <Link
                        href={`/assets/${record.asset_id}`}
                        className="underline"
                      >
                        {record.name}
                      </Link>
                    </td>
                    <td className="p-2">
                      {number(record.received_quantity)}
                    </td>
                    <td className="p-2">
                      {number(record.transfer_cost)}
                    </td>
                    <td className="p-2">
                      {new Date(record.received_at).toUTCString()}
                    </td>
                    <td className="break-all p-2">
                      {record.transfer_id}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!workspace.records.length && (
            <p>No completed transfers in your permitted scope.</p>
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">
            Recorded human reviews
          </h2>

          {!workspace.reviews.length && <p>No reviews recorded.</p>}

          {workspace.reviews.map((review) => (
            <article key={review.audit_id} className="rounded border p-3">
              <p>
                <strong>{review.name}</strong> · {review.chosen_action}
              </p>
              <p>{review.reason}</p>
              <p className="text-xs">
                {review.reviewer} ·{" "}
                {new Date(review.occurred_at).toUTCString()}
              </p>
            </article>
          ))}
        </section>
      </main>
    </>
  );
}

export default function SustainabilityPage() {
  return (
    <Suspense fallback={<p className="p-4">Loading sustainability…</p>}>
      <Dashboard />
    </Suspense>
  );
}