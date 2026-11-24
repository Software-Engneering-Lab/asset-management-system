import Link from "next/link";

// Forgot password (FR-01, FR-03): only the System Administrator can help.
// She sets a temporary password on Users & roles; nobody can read a real password
// (Supabase stores only a one-way hash). No e-mail link is used: demo e-mails cannot receive mail.
export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-semibold">Forgot your password?</h1>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>Contact the <strong>System Administrator</strong>.</li>
          <li>She gives you a <strong>temporary password</strong> privately.</li>
          <li>Sign in with it, then click <strong>Change password</strong> in the top menu and choose your own.</li>
        </ol>
        <p className="mt-4 text-xs text-muted-foreground">
          For your security, nobody can see your real password, not even the administrator.
        </p>
        <Link href="/auth/login" className="mt-4 inline-block text-sm text-primary underline">Back to sign in</Link>
      </div>
    </div>
  );
}
