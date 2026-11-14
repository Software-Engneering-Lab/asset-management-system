import { Suspense } from "react";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import NavBar from "@/components/NavBar";
import { AuthService } from "@/lib/auth/AuthService";
import { AssetService } from "@/lib/services/AssetService";
import { publishAssetAction } from "./actions";

const MESSAGES: Record<string, string> = {
  registered: "Asset registered. It is not visible to requesters until it is published.",
  published: "Asset published. Requesters can now find it in search.",
};

async function AssetDetailPageContent({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  const user = await AuthService.requireUser();
  const { id } = await params;
  const { msg, error } = await searchParams;

  // Row-level security returns nothing if this user may not see the asset
  const asset = await AssetService.getById(id);
  if (!asset) notFound();
  const history = await AssetService.getHistory(id);
  const canPublish = AssetService.canPublish(user, asset);

  const row = (label: string, value: ReactNode) => (
    <div className="grid grid-cols-3 gap-2 border-t py-2 text-sm">
      <dt className="font-medium text-muted-foreground">{label}</dt>
      <dd className="col-span-2">{value ?? "—"}</dd>
    </div>
  );

  return (
    <>
      <NavBar user={user} />
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        {msg && MESSAGES[msg] && (
          <p role="status" className="rounded border border-green-300 bg-green-50 p-2 text-sm text-green-800">{MESSAGES[msg]}</p>
        )}
        {error && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</p>
        )}

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{asset.name}</h1>
            <p className="text-xs text-muted-foreground">Asset ID: {asset.asset_id}</p>
          </div>
          {canPublish && (
            <form action={publishAssetAction}>
              <input type="hidden" name="asset_id" value={asset.asset_id} />
              <button type="submit" className="rounded bg-green-800 px-4 py-2 text-sm font-medium text-white">
                Publish as surplus
              </button>
            </form>
          )}
        </div>

        <dl className="rounded border bg-card px-4">
          {row("State", `${asset.asset_state}${asset.is_published ? " (published)" : " (not published)"}`)}
          {row("Description", asset.description)}
          {row("Category", asset.asset_category?.name)}
          {row("Condition", asset.condition)}
          {row("Quantity (available / total)", `${asset.available_quantity} / ${asset.quantity}`)}
          {row("Owning department", asset.department ? `${asset.department.code} – ${asset.department.name}` : null)}
          {row("Location", asset.location)}
          {row("Custodian", asset.app_user?.full_name)}
          {row("Purchase date", asset.purchase_date)}
          {row("Estimated value (AED / unit)", asset.estimated_value)}
          {row("Material / weight", [asset.material_type, asset.weight_kg != null ? `${asset.weight_kg} kg` : null].filter(Boolean).join(" · ") || null)}
          {row("Expected end of life", asset.expected_end_of_life)}
        </dl>

        <section>
          <h2 className="mb-2 font-semibold">History (who did what, and when)</h2>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No history recorded.</p>
          ) : (
            <table className="w-full rounded border bg-card text-left text-sm">
              <thead className="bg-muted">
                <tr><th className="p-2">When</th><th className="p-2">Event</th><th className="p-2">State change</th><th className="p-2">By</th><th className="p-2">Details</th></tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.event_id} className="border-t">
                    <td className="p-2">{new Date(h.event_at).toLocaleString("en-GB")}</td>
                    <td className="p-2">{h.event_type}</td>
                    <td className="p-2">{h.previous_state ?? "—"} → {h.new_state ?? "—"}</td>
                    <td className="p-2">{h.app_user?.full_name ?? "—"}</td>
                    <td className="p-2">{h.details ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}

// Cache Components: data that depends on the signed-in user loads inside <Suspense>.
export default function AssetDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <AssetDetailPageContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
