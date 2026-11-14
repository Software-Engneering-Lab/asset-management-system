import { redirect } from "next/navigation";

// Home page: signed-in users go to asset search; the proxy sends everyone else to /auth/login.
export default function Home() {
  redirect("/search");
}
