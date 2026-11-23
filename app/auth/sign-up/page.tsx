import Link from "next/link";

// No self sign-up: only the System Administrator creates accounts (UC-01, FR-03),
// on Users & roles → "Create a user".
export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm rounded-lg border bg-card p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-semibold">Accounts are created by the administrator</h1>
        <p className="text-sm text-muted-foreground">
          You cannot create your own account. Ask the System Administrator to create one for you.
          You will receive a temporary password and choose your own after your first sign-in.
        </p>
        <Link href="/auth/login" className="mt-4 inline-block text-sm text-primary underline">Back to sign in</Link>
      </div>
    </div>
  );
}
