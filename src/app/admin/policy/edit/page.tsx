import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { getPolicy, listPolicies } from "@/server/policy/load";
import { listYears } from "@/server/services/academicYears";
import { suggestVersionName } from "@/server/services/policies";
import { PageHeader } from "@/components/ui";
import { editableParameters } from "@/lib/policyParams";
import { PolicyEditor } from "./PolicyEditor";

export const metadata = { title: "Edit policy values" };

export default async function EditPolicyPage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  await requireAdmin();
  const [recs, years] = await Promise.all([listPolicies(), listYears()]);
  const { from } = await searchParams;
  const base = recs.find((r) => r.id === from) ?? recs.at(-1);
  if (!base) return <p>No policy installed. Run <code>npm run seed</code>.</p>;
  const policy = await getPolicy(base.id);
  const ids = recs.map((r) => r.id);
  const target = years.find((y) => !y.historicalOnly && y.status !== "CLOSED") ?? years[0];
  const yearStem = (target?.id ?? "AY2025-26").replace(/^AY/, "");
  return (
    <div className="stack">
      <PageHeader
        title="Edit policy values"
        subtitle={<>Starting from <span className="mono">{base.id}</span> — {policy.label}. Saving creates a new, immutable version; <span className="mono">{base.id}</span> and every submission scored with it stay unchanged.</>}
        crumbs={[{ href: "/admin/policy", label: "Policy" }]}
        actions={<Link className="btn" href={`/admin/policy?v=${encodeURIComponent(base.id)}`}>Cancel</Link>}
      />
      <PolicyEditor
        baseVersion={base.id}
        baseLabel={policy.label}
        params={editableParameters(policy)}
        versions={ids}
        suggestedVersion={suggestVersionName(ids, yearStem)}
        defaultEffectiveFrom={target?.startDate ?? policy.effectiveFrom}
        years={years
          .filter((y) => !y.historicalOnly)
          .map((y) => ({ id: y.id, label: y.label, policyVersion: y.policyVersion, startDate: y.startDate }))}
      />
    </div>
  );
}
