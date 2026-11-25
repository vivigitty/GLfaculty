import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { getPolicy, listPolicies } from "@/server/policy/load";
import { listYears } from "@/server/services/academicYears";
import { policyUsage, suggestVersionName } from "@/server/services/policies";
import { PageHeader } from "@/components/ui";
import { editableParameters } from "@/lib/policyParams";
import { PolicyEditor } from "./PolicyEditor";

export const metadata = { title: "Edit policy values" };

export default async function EditPolicyPage({ searchParams }: { searchParams: Promise<{ from?: string; mode?: string }> }) {
  await requireAdmin();
  const [recs, years] = await Promise.all([listPolicies(), listYears()]);
  const { from, mode } = await searchParams;
  const base = recs.find((r) => r.id === from) ?? recs.at(-1);
  if (!base) return <p>No policy installed. Run <code>npm run seed</code>.</p>;
  const policy = await getPolicy(base.id);
  const usage = await policyUsage(base.id);
  // In-place editing is only offered for a version nothing has been submitted, approved or paid under.
  const inPlace = mode === "inplace" && !usage.inUse;
  const ids = recs.map((r) => r.id);
  const target = years.find((y) => !y.historicalOnly && y.status !== "CLOSED") ?? years[0];
  const yearStem = (target?.id ?? "AY2025-26").replace(/^AY/, "");
  return (
    <div className="stack">
      <PageHeader
        title="Edit policy values"
        subtitle={
          inPlace ? (
            <>Editing <span className="mono">{base.id}</span> — {policy.label} — in place. It has not been used by any submitted, approved or paid record, so saving updates this version directly; drafts pick up the new values. The previous values are kept in the audit log.</>
          ) : (
            <>Starting from <span className="mono">{base.id}</span> — {policy.label}. Saving creates a new, immutable version; <span className="mono">{base.id}</span> and every submission scored with it stay unchanged.</>
          )
        }
        crumbs={[{ href: "/admin/policy", label: "Policy" }]}
        actions={<Link className="btn" href={`/admin/policy?v=${encodeURIComponent(base.id)}`}>Cancel</Link>}
      />
      {mode === "inplace" && usage.inUse && (
        <div className="alert alert-warn" role="status">
          <div><span className="mono">{base.id}</span> is already in use ({usage.reasons.join("; ")}), so it can only be edited as a new version.</div>
        </div>
      )}
      <PolicyEditor
        inPlace={inPlace ? { rev: base._rev } : null}
        baseVersion={base.id}
        baseLabel={policy.label}
        params={editableParameters(policy)}
        versions={ids}
        suggestedVersion={suggestVersionName(ids, yearStem)}
        defaultEffectiveFrom={inPlace ? policy.effectiveFrom : target?.startDate ?? policy.effectiveFrom}
        years={years
          .filter((y) => !y.historicalOnly)
          .map((y) => ({ id: y.id, label: y.label, policyVersion: y.policyVersion, startDate: y.startDate }))}
      />
    </div>
  );
}
