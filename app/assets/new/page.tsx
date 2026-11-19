import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import AssetForm from "./AssetForm";
import { AuthService } from "@/lib/auth/AuthService";
import { AssetService } from "@/lib/services/AssetService";
import { DepartmentService } from "@/lib/services/DepartmentService";
import { ROLES } from "@/lib/constants";

async function NewAssetPageContent() {
  // Requesters typing /assets/new directly are sent to /access-denied
  const user = await AuthService.requireRole(ROLES.CUSTODIAN, ROLES.ADMIN);

  const [categories, allDepartments, custodians] = await Promise.all([
    AssetService.listCategories(),
    DepartmentService.list(true),
    AssetService.listCustodians(),
  ]);

  // Custodians can only register for their own department (also enforced in the database)
  const departments = AuthService.hasRole(user, ROLES.ADMIN)
    ? allDepartments
    : allDepartments.filter((d) => d.department_id === user.departmentId);

  return (
    <>
      <NavBar user={user} />
      <main className="mx-auto max-w-4xl space-y-4 p-4">
        <h1 className="text-xl font-semibold">Register asset</h1>
        <AssetForm
          categories={categories}
          departments={departments}
          custodians={custodians}
          defaultDepartmentId={user.departmentId}
          defaultCustodianId={user.userId}
        />
      </main>
    </>
  );
}

// Cache Components: data that depends on the signed-in user loads inside <Suspense>.
export default function NewAssetPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <NewAssetPageContent />
    </Suspense>
  );
}
