import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import { AuthService } from "@/lib/auth/AuthService";
import { createClient } from "@/lib/supabase/server";
import AssetFactsForm from "./AssetFactsForm";

type AssetOption = {
  asset_id: string;
  name: string;
  description: string;
  condition: string;
  department_id: string;
  facts_current: boolean;
};

async function AssetFactsWorkspace() {
  const user = await AuthService.requireRole("admin", "custodian");
  const db = await createClient();
  const { data, error } = await db.rpc("renad_asset_facts_workspace");
  const assets = (data?.assets ?? []) as AssetOption[];
  return <>
    <NavBar user={user} />
    <main className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-2xl font-semibold">Verify reusable asset facts</h1>
      {error ? <p role="alert" className="rounded border p-4">Could not load asset facts: {error.message}</p>
        : assets.length === 0 ? <p>No assets in your authorized department.</p>
        : <AssetFactsForm assets={assets} />}
    </main>
  </>;
}

export default function AssetFactsPage() {
  return <Suspense fallback={<p className="p-4">Loading asset facts...</p>}><AssetFactsWorkspace /></Suspense>;
}
