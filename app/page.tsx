import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AuthService } from "@/lib/auth/AuthService";

// Home: each role goes to a page it may open; signed-out users go to login.
async function HomeContent() {
  const user = await AuthService.requireUser();
  redirect(AuthService.homePath(user));
  return null;
}

export default function Home() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <HomeContent />
    </Suspense>
  );
}
