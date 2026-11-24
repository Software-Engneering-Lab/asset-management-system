import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import { AuthService } from "@/lib/auth/AuthService";
import { createClient } from "@/lib/supabase/server";
import type { ApprovalRequest } from "@/lib/approvals/types";
import ApprovalCard from "./ApprovalCard";

async function ApprovalWorkspace() {
  const user = await AuthService.requireRole("approver", "admin");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("renad_approval_workspace");
  const requests: ApprovalRequest[] = data?.requests ?? [];

  return <>
    <NavBar user={user} />
    <main className="mx-auto max-w-5xl space-y-5 p-4">
      <h1 className="text-2xl font-semibold">Approvals and reservations</h1>
      <p className="text-sm text-muted-foreground">Review a request, then approve and reserve eligible stock. Both steps are saved together.</p>
      {error ? <p role="alert" className="rounded border p-4">
        {error.code === "PGRST202"
          ? "Approval functions are not installed yet. Apply the reviewed Renad migration after Budoor’s access migration."
          : error.code === "42501" ? "An active approver/admin profile and active department are required."
          : "Requests could not be loaded. Check the database connection and retry."}
      </p> : requests.length === 0 ? <p>No requests are waiting for review or reservation.</p> : <>
        <p className="text-sm">Showing up to 100 open requests, oldest first.</p>
        {requests.map(request => <ApprovalCard key={request.request_id} request={request} userId={user.userId} />)}
      </>}
    </main>
  </>;
}

// Matches main's Cache Components setup: session-dependent work stays inside Suspense.
export default function ApprovalsPage() {
  return <Suspense fallback={<p className="p-4" role="status">Loading approvals…</p>}><ApprovalWorkspace /></Suspense>;
}
