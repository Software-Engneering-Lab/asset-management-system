import { Suspense } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import AssetTable from "@/components/AssetTable";
import { AuthService } from "@/lib/auth/AuthService";
import { AssetService } from "@/lib/services/AssetService";
import { ROLES } from "@/lib/constants";

async function AssetsPageContent() {
  const user = await AuthService.requireRole(ROLES.CUSTODIAN, ROLES.ADMIN, ROLES.APPROVER);
  const assets = await AssetService.listManaged(user);
  const canRegister = AuthService.hasRole(user, ROLES.CUSTODIAN, ROLES.ADMIN);

  return (
    <>
      <NavBar user={user} />
      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">My department&apos;s assets</h1>
          {canRegister && (
            <Link href="/assets/new" className="rounded bg-primary px-3 py-2 text-sm text-primary-foreground">
              + Register asset
            </Link>
          )}
        </div>
        <AssetTable assets={assets} emptyMessage="No assets registered for your department yet." />
      </main>
    </>
  );
}

// Cache Components: data that depends on the signed-in user loads inside <Suspense>.
export default function AssetsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <AssetsPageContent />
    </Suspense>
  );
}
