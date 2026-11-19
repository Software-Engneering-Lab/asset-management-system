import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthService } from "@/lib/auth/AuthService";
import { signOutAction } from "@/app/actions/auth";
import LoginForm from "./LoginForm";

// C1 – sign-in also checks the app_user profile and that the account is active.
async function PageContent() {
  const user = await AuthService.getCurrentUser();
  if (user) redirect(AuthService.homePath(user));

  // Signed in to Supabase, but no active profile (new sign-up or deactivated account)
  const blocked = await AuthService.hasSession();

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="mb-1 text-xl font-semibold">Circular Campus Resource Exchange</h1>
        {blocked ? (
          <>
            <p role="alert" className="mt-4 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
              Your account does not have access yet. Ask the System Administrator to activate it.
            </p>
            <form action={signOutAction} className="mt-4">
              <button type="submit" className="w-full rounded border px-4 py-2 font-medium">Sign out</button>
            </form>
          </>
        ) : (
          <>
            <p className="mb-6 text-sm text-muted-foreground">Sign in with your university account.</p>
            <LoginForm />
          </>
        )}
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
