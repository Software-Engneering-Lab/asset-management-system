import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import { AuthService } from "@/lib/auth/AuthService";
import { createClient } from "@/lib/supabase/server";
import ActionForm from "./ActionForm";
import EligibilityCard from "./EligibilityCard";
import TransferCard from "./TransferCard";
import type { Workspace } from "./types";

async function TransferWorkspace() {
  const user = await AuthService.requireRole("requester", "custodian", "approver", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("renad_transfer_workspace");
  const workspace = data as Workspace | null;
  return <>
    <NavBar user={user} />
    <main className="mx-auto max-w-5xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Transfers</h1>
      <p className="text-sm">The sending custodian arranges and records handover. The named receiver confirms receipt. Any discrepancy must be resolved before completion.</p>
      {error || !workspace ? <p role="alert" className="rounded border p-4">
        {error?.code === "42501" ? "An active role and department are required." : "Transfers could not be loaded. Check the connection and that the transfer migrations have been applied."}
      </p> : <>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Reserved assets awaiting arrangement</h2>
          {!workspace.holds.length && <p>No reservations are waiting for you to arrange.</p>}
          {workspace.holds.map(h => <ActionForm key={h.reservation_id} id={h.reservation_id} operation="create">
            <p>{h.asset_name} · {h.quantity} units → {h.receiving_department}</p>
            <p className="text-sm">Expires: {new Date(h.expires_at).toUTCString()}</p>
            <button type="submit" className="rounded bg-blue-950 px-3 py-2 text-sm text-white">Create transfer</button>
          </ActionForm>)}
        </section>
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Your accessible transfers</h2>
          <p className="text-sm">Showing up to 100 most recent transfers you are permitted to view.</p>
          {!workspace.transfers.length && <p>No transfers to display.</p>}
          {workspace.transfers.map(t => <TransferCard key={t.transfer_id} transfer={t} people={workspace.people} userId={user.userId} />)}
        </section>
        <section id="eligibility" className="space-y-3">
          <h2 className="text-xl font-semibold">Confirm requirements and asset facts</h2>
          <p className="text-sm">Requesters confirm the item type. Custodians verify actual specifications and safety before approval or handover. Showing up to 100 relevant open requests.</p>
          {!workspace.checks.length && <p>No requirement or asset checks are assigned to you.</p>}
          {workspace.checks.map(q => <EligibilityCard key={q.request_id} check={q} />)}
        </section>
      </>}
    </main>
  </>;
}

// Session-dependent loading follows the existing project's Suspense pattern.
export default function TransfersPage() {
  return <Suspense fallback={<p role="status" className="p-4">Loading transfers…</p>}><TransferWorkspace /></Suspense>;
}
