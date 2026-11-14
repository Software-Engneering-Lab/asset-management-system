import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import DepartmentForm from "./DepartmentForm";
import { toggleDepartmentAction } from "./actions";
import { AuthService } from "@/lib/auth/AuthService";
import { DepartmentService } from "@/lib/services/DepartmentService";
import { ROLES } from "@/lib/constants";

async function DepartmentsPageContent() {
  const user = await AuthService.requireRole(ROLES.ADMIN);
  const departments = await DepartmentService.list();

  return (
    <>
      <NavBar user={user} />
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <h1 className="text-xl font-semibold">Departments</h1>
        <DepartmentForm />
        <table className="w-full rounded border bg-card text-left text-sm">
          <thead className="bg-muted">
            <tr><th className="p-2">Code</th><th className="p-2">Name</th><th className="p-2">Status</th><th className="p-2"></th></tr>
          </thead>
          <tbody>
            {departments.map((d) => (
              <tr key={d.department_id} className="border-t">
                <td className="p-2 font-mono">{d.code}</td>
                <td className="p-2">{d.name}</td>
                <td className="p-2">{d.is_active ? "Active" : "Inactive"}</td>
                <td className="p-2">
                  <form action={toggleDepartmentAction}>
                    <input type="hidden" name="department_id" value={d.department_id} />
                    <input type="hidden" name="make_active" value={String(!d.is_active)} />
                    <button type="submit" className="rounded border bg-background px-2 py-1">
                      {d.is_active ? "Deactivate" : "Reactivate"}
                    </button>
                  </form>
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
export default function DepartmentsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <DepartmentsPageContent />
    </Suspense>
  );
}
