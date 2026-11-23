import { redirect } from "next/navigation";

// Old starter-kit page. There is no self sign-up (only the administrator creates accounts),
// so send anyone who lands here to sign in.
export default function Page() {
  redirect("/auth/login");
}
