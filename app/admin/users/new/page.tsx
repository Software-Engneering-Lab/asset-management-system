import { Suspense } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import { AuthService } from "@/lib/auth/AuthService";
import { DepartmentService } from "@/lib/services/DepartmentService";
import { UserAdminService } from "@/lib/services/UserAdminService";
import { ROLES } from "@/lib/constants";
import { createUserAction } from "../create-user-action";

// What each role may do (Phase 4–5, Section 6.2) – shown next to the checkbox
const ROLE_HELP: Record<string, string> = {
  requester: "Searches assets and submits requests",
  custodian: "Registers and publishes assets of her department",
  approver: "Reviews, approves and reserves requests",
  admin: "Manages accounts, roles and departments",
};

/**
 * Add user (C1, UC-01, FR-03) – only the System Administrator creates accounts.
 * The admin chooses the department and the roles. There is no self sign-up.
 * Follows Phase 4–5 Figure 2.2a: 1.2 Validate account and role data → 1.4 Save → confirmation.
 */
async function AddUserContent({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await AuthService.requireRole(ROLES.ADMIN);
  const { error } = await searchParams;
  const [departments, roles] = await Promise.all([DepartmentService.list(true), UserAdminService.listRoles()]);

  const field = "mt-1 w-full rounded border bg-background px-3 py-2";

  return (
    <>
      <NavBar user={user} />
      <main className="mx-auto max-w-xl space-y-4 p-4">
        <p><Link href="/admin/users" className="text-sm text-primary underline">← Users & roles</Link></p>
        <h1 className="text-xl font-semibold">Add user</h1>
        <p className="text-sm text-muted-foreground">
          Create an account for a member of staff. You choose her department and roles. She signs in with a
          temporary password and then chooses her own.
        </p>

        {error && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</p>
        )}

        <form action={createUserAction} className="space-y-4 rounded border bg-card p-4">
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium">Full name *</label>
            <input id="full_name" name="full_name" required maxLength={120} className={field} />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium">University email *</label>
            <input id="email" name="email" type="email" required maxLength={150} className={field} />
          </div>
          <div>
            <label htmlFor="department_id" className="block text-sm font-medium">Department *</label>
            <select id="department_id" name="department_id" required defaultValue="" className={field}>
              <option value="">Choose…</option>
              {departments.map((d) => (
                <option key={d.department_id} value={d.department_id}>{d.code} – {d.name}</option>
              ))}
            </select>
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Roles * (at least one)</legend>
            <div className="mt-2 space-y-2">
              {roles.map((r) => (
                <label key={r.role_id} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name="role_ids" value={r.role_id} className="mt-1" />
                  <span>
                    <span className="font-medium">{r.role_name}</span>
                    {ROLE_HELP[r.role_name] && (
                      <span className="block text-xs text-muted-foreground">{ROLE_HELP[r.role_name]}</span>
                    )}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="temp_password" className="block text-sm font-medium">Temporary password</label>
            <input id="temp_password" name="temp_password" type="text" minLength={8} autoComplete="off"
              placeholder="Leave empty to generate one" className={field} />
            <p className="mt-1 text-xs text-muted-foreground">
              After saving, it is shown to you as •••••••• with Show and Copy, for 2 minutes. It is never stored.
            </p>
          </div>
          <button type="submit" className="w-full rounded bg-primary px-4 py-2 font-medium text-primary-foreground">
            Create account
          </button>
        </form>
      </main>
    </>
  );
}

// Cache Components: data that depends on the signed-in user loads inside <Suspense>.
export default function AddUserPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <AddUserContent searchParams={searchParams} />
    </Suspense>
  );
}
