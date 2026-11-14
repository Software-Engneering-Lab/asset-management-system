import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthService } from "@/lib/auth/AuthService";
import LoginForm from "./LoginForm";

// C1 – replaces the starter-kit login so sign-in also checks the app_user profile and account status.
async function PageContent() {
  if (await AuthService.getCurrentUser()) redirect("/assets");

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Circular Campus Resource Exchange</h1>
        <p className="mb-6 text-sm text-muted-foreground">Sign in with your university account.</p>
        <LoginForm />
        <p className="mt-6 text-xs text-muted-foreground">Prototype – fictional data only.</p>
      </div>
    </div>
  );
}

// Cache Components: data that depends on the signed-in user loads inside <Suspense>.
export default function Page() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <PageContent />
    </Suspense>
  );
}
