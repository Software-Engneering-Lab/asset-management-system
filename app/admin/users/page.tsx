import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import NavBar from "@/components/NavBar";
import SecretText from "@/components/SecretText";
import { assignRoleAction, removeRoleAction, provisionProfileAction, setAccountStatusAction } from "./actions";
import { DepartmentService } from "@/lib/services/DepartmentService";
import { AuthService } from "@/lib/auth/AuthService";
import { UserAdminService } from "@/lib/services/UserAdminService";
import { ROLES } from "@/lib/constants";
import { setTemporaryPasswordAction } from "./password-actions";
import { updateProfileAction } from "./profile-actions";
import { TEMP_PASSWORD_COOKIE } from "./temp-password-cookie";

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

  // Temporary password just set: shown once (cookie expires after 2 minutes, never stored in a table)
  let tempNotice: { userId: string; name: string; password: string } | null = null;
  const raw = (await cookies()).get(TEMP_PASSWORD_COOKIE)?.value;
  if (msg === "password_set" && raw) {
    try {
      const { userId, password } = JSON.parse(raw) as { userId: string; password: string };
      const target = users.find((u) => u.user_id === userId);
      tempNotice = { userId, name: target?.full_name ?? "the user", password };
    } catch {
      tempNotice = null;
    }
  }

  return (
    <>
      <NavBar user={user} />
      <main className="mx-auto max-w-5xl space-y-4 p-4">
        <h1 className="text-xl font-semibold">Users and roles</h1>
        <p className="text-sm text-muted-foreground">
          Only the administrator creates accounts (Add user) and chooses each user&apos;s department and roles. Every change is recorded in the audit log. Real passwords are never shown. If a user forgets hers, click Set next to her name: a temporary password is generated and shown to you as •••••••• with Show and Copy.
        </p>
        {tempNotice ? (
          <div role="status" className="rounded border border-green-300 bg-green-50 p-3 text-sm text-green-900">
            <p className="flex flex-wrap items-center gap-2">
              Temporary password for <strong>{tempNotice.name}</strong>:
              <SecretText value={tempNotice.password} label={`Temporary password for ${tempNotice.name}`} />
            </p>
            <p className="mt-1">
              Click Show or Copy now. It is shown only for 2 minutes and is never saved. Give it to the user
              privately and ask her to change it after signing in (Change password).
            </p>
          </div>
        ) : (
          msg && (
            <p role="status" className="rounded border border-green-300 bg-green-50 p-2 text-sm text-green-800">
              {msg === "password_set" ? "Temporary password set." : "Change saved."}
            </p>
          )
        )}
        {error && <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</p>}

        <p>
          <Link href="/admin/users/new" className="inline-block rounded bg-primary px-3 py-2 text-sm text-primary-foreground">
            + Add user
          </Link>
        </p>

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
            <tr><th className="p-2">User</th><th className="p-2">Department</th><th className="p-2">Status</th><th className="p-2">Roles</th><th className="p-2">Add role</th><th className="p-2">Password</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id} className="border-t align-top">
                <td className="p-2">
                  {u.full_name}<br /><span className="text-xs text-muted-foreground">{u.email}</span>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-primary underline">edit</summary>
                    <form action={updateProfileAction} className="mt-2 space-y-2">
                      <input type="hidden" name="user_id" value={u.user_id} />
                      <label className="block text-xs">Full name
                        <input name="full_name" required maxLength={120} defaultValue={u.full_name}
                          className="mt-1 w-full rounded border bg-background px-2 py-1" />
                      </label>
                      <label className="block text-xs">Department
                        <select name="department_id" required defaultValue={u.department_id ?? ""}
                          className="mt-1 w-full rounded border bg-background px-2 py-1">
                          {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.code}</option>)}
                        </select>
                      </label>
                      <button type="submit" className="rounded border bg-background px-2 py-1 text-xs">Save</button>
                    </form>
                  </details>
                </td>
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
                <td className="p-2">
                  {tempNotice?.userId === u.user_id && (
                    <div className="mb-2">
                      <SecretText value={tempNotice.password} label={`Temporary password for ${u.full_name}`} />
                    </div>
                  )}
                  {u.user_id === user.userId ? (
                    <span className="text-xs text-muted-foreground">Change your own on the change-password page.</span>
                  ) : (
                    <form action={setTemporaryPasswordAction} className="flex gap-2">
                      <input type="hidden" name="user_id" value={u.user_id} />
                      <label htmlFor={`pw-${u.user_id}`} className="sr-only">Temporary password for {u.full_name}</label>
                      <input
                        id={`pw-${u.user_id}`}
                        name="temp_password"
                        type="text"
                        minLength={8}
                        autoComplete="off"
                        placeholder="Empty = generate one"
                        className="w-40 rounded border bg-background px-2 py-1"
                      />
                      <button type="submit" className="rounded border bg-background px-2 py-1">Set</button>
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
