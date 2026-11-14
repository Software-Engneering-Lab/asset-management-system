import Link from "next/link";

export default function AccessDeniedPage() {
  return (
    <main className="mx-auto mt-24 max-w-md text-center">
      <h1 className="text-xl font-semibold">Access denied</h1>
      <p className="mt-2 text-muted-foreground">
        Your role does not allow this action. If you think this is wrong, contact the System Administrator.
      </p>
      <Link href="/search" className="mt-4 inline-block text-primary underline">Go to asset search</Link>
    </main>
  );
}
