import { redirect } from "next/navigation";

// Old starter-kit page: send people to the app's home, which picks the right page for their role.
export default function ProtectedPage() {
  redirect("/");
}
