import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { AuthService } from "@/lib/auth/AuthService";
import { ROLES } from "@/lib/constants";
import type { CurrentUser } from "@/lib/types";

/** Top bar shown on every signed-in page. Links depend on the user's roles. */
export default function NavBar({ user }: { user: CurrentUser }) {
  const canManageAssets = AuthService.hasRole(user, ROLES.CUSTODIAN, ROLES.ADMIN, ROLES.APPROVER);
  // Only Asset Custodians register assets (Phase 4–5, UC-02). Admin alone cannot.
  const canRegister = AuthService.hasRole(user, ROLES.CUSTODIAN);
  const isAdmin = AuthService.hasRole(user, ROLES.ADMIN);
  // Admin and Approver see every department's assets, so the link says "All assets".
  const seesAllDepartments = AuthService.hasRole(user, ROLES.ADMIN, ROLES.APPROVER);

  return (
    <header className="bg-blue-950 text-white">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
        <span className="font-semibold">Campus Resource Exchange</span>
        <Link href="/search" className="hover:underline">Search assets</Link>
        {/* C4 (Shaikha): request form and tracking live under /protected/requests */}
        <Link href="/protected/requests" className="hover:underline">Requests</Link>
        {canManageAssets && (
          <Link href="/assets" className="hover:underline">
            {seesAllDepartments ? "All assets" : "My department's assets"}
          </Link>
        )}
        {canRegister && <Link href="/assets/new" className="hover:underline">Register asset</Link>}
        {isAdmin && <Link href="/admin/departments" className="hover:underline">Departments</Link>}
        {isAdmin && <Link href="/admin/users" className="hover:underline">Users &amp; roles</Link>}
        {isAdmin && <Link href="/admin/users/new" className="hover:underline">Add user</Link>}
        <span className="ml-auto text-blue-100">
          {user.fullName} · {user.roles.join(", ") || "no role"}
          {user.departmentName ? ` · ${user.departmentName}` : ""}
        </span>
        <Link href="/auth/update-password" className="hover:underline">Change password</Link>
        <form action={signOutAction}>
          <button type="submit" className="rounded border border-blue-200 px-2 py-1 hover:bg-blue-900">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}