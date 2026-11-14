import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { AuthService } from "@/lib/auth/AuthService";
import { ROLES } from "@/lib/constants";
import type { CurrentUser } from "@/lib/types";

/** Top bar shown on every signed-in page. Links depend on the user's roles. */
export default function NavBar({ user }: { user: CurrentUser }) {
  const canManageAssets = AuthService.hasRole(user, ROLES.CUSTODIAN, ROLES.ADMIN, ROLES.APPROVER);
  const canRegister = AuthService.hasRole(user, ROLES.CUSTODIAN, ROLES.ADMIN);
  const isAdmin = AuthService.hasRole(user, ROLES.ADMIN);

  return (
    <header className="bg-blue-950 text-white">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
        <span className="font-semibold">Campus Resource Exchange</span>
        <Link href="/search" className="hover:underline">Search assets</Link>
        {canManageAssets && <Link href="/assets" className="hover:underline">My department&apos;s assets</Link>}
        {canRegister && <Link href="/assets/new" className="hover:underline">Register asset</Link>}
        {isAdmin && <Link href="/admin/departments" className="hover:underline">Departments</Link>}
        {isAdmin && <Link href="/admin/users" className="hover:underline">Users &amp; roles</Link>}
        {/* Only approvers and admins see the approval page link. */}
        {AuthService.hasRole(user, ROLES.APPROVER, ROLES.ADMIN) && (
          <Link href="/approvals" className="hover:underline">
            Approvals
          </Link>
        )}
        <span className="ml-auto text-blue-100">
          {user.fullName} · {user.roles.join(", ") || "no role"}
          {user.departmentName ? ` · ${user.departmentName}` : ""}
        </span>
        <form action={signOutAction}>
          <button type="submit" className="rounded border border-blue-200 px-2 py-1 hover:bg-blue-900">
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}
