import Link from "next/link";
import type { Asset } from "@/lib/types";

/** Shared table for the asset list and search results. */
export default function AssetTable({ assets, emptyMessage }: { assets: Asset[]; emptyMessage: string }) {
  if (assets.length === 0) {
    return <p className="rounded border bg-muted p-4 text-muted-foreground">{emptyMessage}</p>;
  }
  return (
    <div className="overflow-x-auto rounded border bg-card">
      <table className="w-full text-left text-sm">
        <thead className="bg-muted">
          <tr>
            <th className="p-2">Name</th>
            <th className="p-2">Category</th>
            <th className="p-2">Department</th>
            <th className="p-2">Location</th>
            <th className="p-2">Condition</th>
            <th className="p-2">Available</th>
            <th className="p-2">State</th>
          </tr>
        </thead>
        <tbody>
          {assets.map((a) => (
            <tr key={a.asset_id} className="border-t">
              <td className="p-2">
                <Link href={`/assets/${a.asset_id}`} className="text-primary underline">{a.name}</Link>
              </td>
              <td className="p-2">{a.asset_category?.name ?? "—"}</td>
              <td className="p-2">{a.department?.code ?? "—"}</td>
              <td className="p-2">{a.location}</td>
              <td className="p-2">{a.condition}</td>
              <td className="p-2">{a.available_quantity} / {a.quantity}</td>
              <td className="p-2">{a.asset_state}{a.is_published ? " (published)" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
