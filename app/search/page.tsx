import { Suspense } from "react";
import NavBar from "@/components/NavBar";
import AssetTable from "@/components/AssetTable";
import { AuthService } from "@/lib/auth/AuthService";
import { AssetService } from "@/lib/services/AssetService";
import { DepartmentService } from "@/lib/services/DepartmentService";
import { CONDITIONS } from "@/lib/constants";

/** C3 – search and filter published assets (FR-12, FR-13). Any signed-in role. */
async function SearchPageContent({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; condition?: string; department?: string }>;
}) {
  const user = await AuthService.requireUser();
  const sp = await searchParams;

  const [categories, departments, results] = await Promise.all([
    AssetService.listCategories(),
    DepartmentService.list(true),
    AssetService.search({
      q: sp.q,
      categoryId: sp.category,
      condition: sp.condition,
      departmentId: sp.department,
    }),
  ]);

  const field = "mt-1 w-full rounded border bg-background px-3 py-2";

  return (
    <>
      <NavBar user={user} />
      <main className="mx-auto max-w-6xl space-y-4 p-4">
        <h1 className="text-xl font-semibold">Search available assets</h1>

        {/* GET form: filters stay in the URL, so results can be bookmarked or refreshed */}
        <form method="get" className="grid gap-3 rounded border bg-card p-4 md:grid-cols-5">
          <div className="md:col-span-2">
            <label htmlFor="q" className="block text-sm font-medium">Keyword</label>
            <input id="q" name="q" defaultValue={sp.q ?? ""} placeholder="e.g. monitor, chair, projector" className={field} />
          </div>
          <div>
            <label htmlFor="category" className="block text-sm font-medium">Category</label>
            <select id="category" name="category" defaultValue={sp.category ?? ""} className={field}>
              <option value="">All</option>
              {categories.map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="condition" className="block text-sm font-medium">Condition</label>
            <select id="condition" name="condition" defaultValue={sp.condition ?? ""} className={field}>
              <option value="">All</option>
              {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="department" className="block text-sm font-medium">Department</label>
            <select id="department" name="department" defaultValue={sp.department ?? ""} className={field}>
              <option value="">All</option>
              {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.code}</option>)}
            </select>
          </div>
          <div className="flex gap-2 md:col-span-5">
            <button type="submit" className="rounded bg-primary px-4 py-2 text-primary-foreground">Search</button>
            <a href="/search" className="rounded border px-4 py-2">Clear</a>
          </div>
        </form>

        <p className="text-sm text-muted-foreground">{results.length} asset(s) found.</p>
        <AssetTable assets={results} emptyMessage="No matching assets were found. Try other keywords or remove a filter." />
      </main>
    </>
  );
}

// Cache Components: data that depends on the signed-in user loads inside <Suspense>.
export default function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; condition?: string; department?: string }>;
}) {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Loading…</p>}>
      <SearchPageContent searchParams={searchParams} />
    </Suspense>
  );
}
