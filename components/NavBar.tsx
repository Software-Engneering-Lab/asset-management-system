import Link from "next/link";
import { signOutAction } from "@/app/actions/auth";
import { AuthService } from "@/lib/auth/AuthService";
import { ROLES } from "@/lib/constants";
import type { CurrentUser } from "@/lib/types";

export default function NavBar({ user }: { user: CurrentUser }) {
  const canManageAssets = AuthService.hasRole(
    user,
    ROLES.CUSTODIAN,
    ROLES.ADMIN,
    ROLES.APPROVER,
  );

  const canRegister = AuthService.hasRole(user, ROLES.CUSTODIAN);

  const canVerifyAssets = AuthService.hasRole(
    user,
    ROLES.CUSTODIAN,
    ROLES.ADMIN,
  );

  const isAdmin = AuthService.hasRole(user, ROLES.ADMIN);

  const seesAllDepartments = AuthService.hasRole(
    user,
    ROLES.ADMIN,
    ROLES.APPROVER,
  );

  const canApprove = AuthService.hasRole(
    user,
    ROLES.APPROVER,
    ROLES.ADMIN,
  );

  const canTransfer = AuthService.hasRole(
    user,
    ROLES.REQUESTER,
    ROLES.CUSTODIAN,
    ROLES.APPROVER,
    ROLES.ADMIN,
  );

  const canViewSustainability = AuthService.hasRole(
    user,
    ROLES.ADMIN,
    ROLES.APPROVER,
    ROLES.CUSTODIAN,
  );

  // These checks control navigation visibility.
  // Pages and database functions must also enforce permissions.
  return (
    <header className="bg-blue-950 text-white">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3 text-sm">
        <span className="font-semibold">
          Campus Resource Exchange
        </span>

        <Link href="/search" className="hover:underline">
          Search assets
        </Link>

        <Link href="/protected/requests" className="hover:underline">
          Requests
        </Link>

        <Link href="/protected/notifications" className="hover:underline">
          Notifications
        </Link>

        {canManageAssets && (
          <Link href="/assets" className="hover:underline">
            {seesAllDepartments
              ? "All assets"
              : "My department's assets"}
          </Link>
        )}

        {canRegister && (
          <Link href="/assets/new" className="hover:underline">
            Register asset
          </Link>
        )}

        {canVerifyAssets && (
          <Link href="/asset-facts" className="hover:underline">
            Verify asset facts
          </Link>
        )}

        {canApprove && (
          <Link href="/approvals" className="hover:underline">
            Approvals
          </Link>
        )}

        {canTransfer && (
          <Link href="/transfers" className="hover:underline">
            Transfers
          </Link>
        )}

        {canViewSustainability && (
          <Link href="/sustainability" className="hover:underline">
            Sustainability
          </Link>
        )}

        {isAdmin && (
          <>
            <Link href="/admin/departments" className="hover:underline">
              Departments
            </Link>

            <Link href="/admin/users" className="hover:underline">
              Users &amp; roles
            </Link>

            <Link href="/admin/users/new" className="hover:underline">
              Add user
            </Link>
          </>
        )}

        <Link href="/auth/update-password" className="hover:underline">
          Change password
        </Link>

        <span className="ml-auto text-blue-100">
          {user.fullName} · {user.roles.join(", ") || "no role"}
          {user.departmentName ? ` · ${user.departmentName}` : ""}
        </span>

        <form action={signOutAction}>
          <button
            type="submit"
            className="rounded border border-blue-200 px-2 py-1 hover:bg-blue-900"
          >
            Sign out
          </button>
        </form>
      </nav>
    </header>
  );
}