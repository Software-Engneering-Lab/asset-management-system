import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import { assignRoleAction, removeRoleAction, provisionProfileAction, setAccountStatusAction } from "./actions";
import { DepartmentService } from "@/lib/services/DepartmentService";
import { AuthService } from "@/lib/auth/AuthService";
import { UserAdminService } from "@/lib/services/UserAdminService";
import { ROLES } from "@/lib/constants";

async function UsersPageContent({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  const user = await AuthService.requireRole(ROLES.ADMIN);
  const { msg, error } = await searchParams;
  const [users, roles, pending, departments] = await Promise.all([
    UserAdminService.listUsers(),
    UserAdminService.listRoles(),
    UserAdminService.listUnprovisioned(),
    DepartmentService.list(true),
  ]);

  return (
    <>
      <NavBar user={user} />
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <h1 className="text-xl font-semibold">Users and roles</h1>
        <p className="text-sm text-muted-foreground">
          New sign-ups get no access until an administrator creates their profile and assigns a role. Every change is recorded in the audit log.
        </p>
        {msg && <p role="status" className="rounded border border-green-300 bg-green-50 p-2 text-sm text-green-800">Change saved.</p>}
        {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</p>}

        {pending.length > 0 && (
          <section className="space-y-2 rounded border bg-card p-4">
            <h2 className="font-semibold">New accounts waiting for a profile</h2>
            {pending.map((p) => (
              <form key={p.user_id} action={provisionProfileAction} className="flex flex-wrap items-end gap-2 border-t pt-2">
                <input type="hidden" name="user_id" value={p.user_id} />
                <span className="min-w-56 text-sm">{p.email}</span>
                <label className="text-sm">Full name
                  <input name="full_name" required maxLength={120} className="ml-1 rounded border bg-background px-2 py-1" />
                </label>
                <label className="text-sm">Department
                  <select name="department_id" required defaultValue="" className="ml-1 rounded border bg-background px-2 py-1">
                    <option value="">Choose…</option>
                    {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.code}</option>)}
                  </select>
                </label>
                <button type="submit" className="rounded border bg-background px-2 py-1">Create profile</button>
              </form>
            ))}
          </section>
        )}

        <table className="w-full rounded border bg-card text-left text-sm">
          <thead className="bg-muted">
            <tr><th className="p-2">User</th><th className="p-2">Department</th><th className="p-2">Status</th><th className="p-2">Roles</th><th className="p-2">Add role</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id} className="border-t align-top">
                <td className="p-2">{u.full_name}<br /><span className="text-xs text-muted-foreground">{u.email}</span></td>
                <td className="p-2">{u.department_name ?? "—"}</td>
                <td className="p-2">
                  {u.account_status}
                  {u.user_id !== user.userId && (
                    <form action={setAccountStatusAction}>
                      <input type="hidden" name="user_id" value={u.user_id} />
                      <input type="hidden" name="status" value={u.account_status === "active" ? "inactive" : "active"} />
                      <button type="submit" className="text-xs text-primary underline">
                        {u.account_status === "active" ? "deactivate" : "activate"}
                      </button>
                    </form>
                  )}
                </td>
                <td className="p-2">
                  <ul className="space-y-1">
                    {u.roles.map((r) => (
                      <li key={r.user_role_id} className="flex items-center gap-2">
                        <span>{r.role_name}</span>
                        {u.user_id !== user.userId && (
                          <form action={removeRoleAction}>
                            <input type="hidden" name="user_role_id" value={r.user_role_id} />
                            <button type="submit" className="text-xs text-red-700 underline" aria-label={`Remove ${r.role_name} from ${u.full_name}`}>remove</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ul>
                </td>
                <td className="p-2">
                  {u.user_id === user.userId ? (
                    <span className="text-xs text-muted-foreground">You cannot change your own roles.</span>
                  ) : (
                    <form action={assignRoleAction} className="flex gap-2">
                      <input type="hidden" name="user_id" value={u.user_id} />
                      <label htmlFor={`role-${u.user_id}`} className="sr-only">Role</label>
                      <select id={`role-${u.user_id}`} name="role_id" defaultValue="" className="rounded border bg-background px-2 py-1">
                        <option value="">Choose…</option>
                        {roles.filter((r) => !u.roles.some((x) => x.role_name === r.role_name))
                          .map((r) => <option key={r.role_id} value={r.role_id}>{r.role_name}</option>)}
                      </select>
                      <button type="submit" className="rounded border bg-background px-2 py-1">Add</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}

// Cache Components: data that depends on the signed-in user loads inside <Suspense>.
export default function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; error?: string }>;
}) {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <UsersPageContent searchParams={searchParams} />
    </Suspense>
  );
}
