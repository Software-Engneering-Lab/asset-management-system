import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import { AuthService } from "@/lib/auth/AuthService";

// Shared layout for /protected/* (requests, reports): same top menu as the asset pages.
async function Shell({ children }: { children: React.ReactNode }) {
  const user = await AuthService.requireUser();
  return (
    <>
      <NavBar user={user} />
      <main className="mx-auto max-w-6xl space-y-4 p-4">{children}</main>
    </>
  );
}

// Cache Components: data that depends on the signed-in user loads inside <Suspense>.
export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <Shell>{children}</Shell>
    </Suspense>
  );
}
