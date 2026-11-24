import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { listYears } from "@/server/services/academicYears";
import { getPolicy, listPolicies } from "@/server/policy/load";
import { Badge, Card, PageHeader } from "@/components/ui";
import { fmtDateTime, fmtINR } from "@/lib/format";
import { resolveOptions } from "@/lib/policyView";

export const metadata = { title: "Policy" };

const Pending = ({ s }: { s: string }) => (s === "PENDING" ? <Badge tone="warn">pending sign-off</Badge> : <Badge tone="ok">confirmed</Badge>);

export default async function PolicyPage({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  await requireAdmin();
  const [recs, years] = await Promise.all([listPolicies(), listYears()]);
  const { v } = await searchParams;
  const rec = recs.find((r) => r.id === v) ?? recs.at(-1);
  if (!rec) return <p>No policy installed. Run <code>npm run seed</code>.</p>;
  const p = await getPolicy(rec.id);
  const usedBy = years.filter((y) => y.policyVersion === rec.id).map((y) => y.label);
  return (
    <div className="stack">
      <PageHeader
        title={`Policy ${p.version}`}
        subtitle={`${p.label} · effective ${p.effectiveFrom} · created ${fmtDateTime(rec.createdAt)} from ${rec.source} · used by ${usedBy.length ? usedBy.join(", ") : "no academic year"}`}
        actions={
          <div className="row">
            {recs.length > 1 && (
              <form className="row">
                <select name="v" className="input" defaultValue={rec.id} aria-label="Policy version">{recs.map((r) => <option key={r.id}>{r.id}</option>)}</select>
                <button className="btn btn-sm">View</button>
              </form>
            )}
            <Link className="btn btn-primary" href={`/admin/policy/edit?from=${encodeURIComponent(rec.id)}`}>Edit values as new version</Link>
          </div>
        }
      />
      <div className="alert alert-info">
        <div>
          Every point value, rate and threshold below can be changed from the portal: choose <strong>Edit values as new version</strong>, adjust the values, and assign the new version to an academic year (for example next year, or this year before anything is submitted). Versions are <strong>immutable</strong> — submissions keep the version they were scored with and nothing is silently recalculated. {rec.changeReason && <span className="small">This version: {rec.changeReason}.</span>}
        </div>
      </div>
      <div className="grid-2">
        <Card title="Eligibility & payment parameters">
          <dl className="kv">
            <dt>Research rate</dt><dd>{fmtINR(p.parameters.researchRatePerPoint)} / point</dd>
            <dt>Minimum — Standard</dt><dd>{p.parameters.minimumPoints.STANDARD}</dd>
            <dt>Minimum — Junior Faculty</dt><dd>{p.parameters.minimumPoints.JUNIOR}</dd>
            <dt>Part-year prorating</dt><dd>{!p.parameters.prorating.enabled ? "off" : p.parameters.prorating.basis === "PERIOD_DAYS" ? "days in service ÷ days in the year (joining and exit)" : `${p.parameters.prorating.dayCount}, ÷ ${p.parameters.prorating.daysInYear}`} <Pending s={p.parameters.prorating.signoff} /></dd>
            <dt>Payment rounding</dt><dd>{{ CEIL_RUPEE: "Round up to the next rupee", NEAREST_RUPEE: "Nearest rupee", NONE: "None" }[p.parameters.paymentRounding]} <Pending s={p.parameters.paymentRoundingSignoff} /></dd>
            {p.parameters.consultingRevenueShare && <><dt>Consulting revenue</dt><dd>{p.parameters.consultingRevenueShare.facultyPercent}:{p.parameters.consultingRevenueShare.institutionPercent} faculty : institution ({p.parameters.consultingRevenueShare.basis}) — not RTS points</dd></>}
            <dt>Formula</dt><dd className="small">P ≤ R: P × research rate; P &gt; R: R × research rate + (P − R) × designation rate</dd>
          </dl>
        </Card>
        <Card title="Designations" subtitle={<>Point rates <Pending s={p.designations.pointRateSignoff} /></>} flush>
          <table className="table table-compact">
            <thead><tr><th>Designation</th><th>Category</th><th className="num">Per point</th><th className="num">Overload / h</th><th className="num">CLD / h</th></tr></thead>
            <tbody>
              {p.designations.items.map((d) => (
                <tr key={d.key}><td>{d.label}</td><td className="small">{d.facultyCategory}</td><td className="num">{fmtINR(d.pointRate)}</td><td className="num">{fmtINR(d.overloadRatePerHour)}</td><td className="num">{fmtINR(d.cldRatePerHour)}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Teaching" subtitle={<>Hours → points <Pending s={p.teaching.pointsConversion.signoff} /></>}>
          <dl className="kv small">
            <dt>Conversion</dt><dd>{p.teaching.pointsConversion.pointsPerHour} point per hour, excluding {p.teaching.pointsConversion.excludedColumns.join(", ")}</dd>
            {p.teaching.courseTypes?.map((c) => [<dt key={`${c.key}k`}>{c.label}</dt>, <dd key={`${c.key}v`}>{c.pointsPerHour} point/h{c.minStudentsPerSection ? ` (≥ ${c.minStudentsPerSection} students per section)` : ""}</dd>])}
            <dt>Programme columns</dt><dd>{p.teaching.columns.map((c) => <span key={c.key}>{c.label}{c.signoff === "PENDING" && <> <Pending s="PENDING" /></>}{" · "}</span>)}</dd>
            <dt>Excluded from cap</dt><dd>{p.teaching.capExcludedColumns.join(", ") || "none"}</dd>
            {p.researchStatuses.map((r) => [<dt key={`${r.key}k`}>{r.label}</dt>, <dd key={`${r.key}v`}>load {r.contractualLoadHours} h · cap {r.teachingCapHours} h</dd>])}
            <dt>New Assistant Professor</dt><dd>{p.teaching.newAssistantProfessor.contractualLoadHours} h for first {p.teaching.newAssistantProfessor.firstYearsOfService} years</dd>
          </dl>
        </Card>
        <Card title="Service roles" flush>
          <table className="table table-compact">
            <tbody>
              {p.service.roles.map((r) => <tr key={r.key}><td>{r.label}{r.signoff === "PENDING" && <> <Pending s="PENDING" /></>}</td><td className="num strong">{r.points}{r.quantity === "COUNT" ? " each" : ""}{r.maxQuantity ? ` (max ${r.maxQuantity})` : ""}</td></tr>)}
            </tbody>
          </table>
          <div className="card-foot tiny muted">Unscored disclosures: {p.service.disclosures.map((d) => d.label).join("; ")}</div>
        </Card>
      </div>
      <Card title="Research activities" flush>
        <table className="table table-compact">
          <thead><tr><th>Section</th><th>Rule</th><th>Values</th></tr></thead>
          <tbody>
            <tr><td>Publication classes</td><td>base × contribution factor</td><td className="small">{p.publication.classes.map((c) => `${c.label}: ${c.basePoints}`).join(" · ")} · paid journal: {p.publication.paidJournalPoints}</td></tr>
            {p.researchSections.map((s) => {
              const lf = s.fields.find((f) => f.key === s.lookupField);
              return (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  <td className="small">{s.calc}</td>
                  <td className="small">
                    {s.maxScoredEntries ? `Best ${s.maxScoredEntries} count. ` : ""}
                    {s.calc === "lookup" && lf ? resolveOptions(p, lf).map((o) => `${o.label}: ${o.eligible === false ? "not eligible" : o.points}${o.signoff === "PENDING" ? " (pending sign-off)" : ""}`).join(" · ") : s.calc === "grant" ? p.grant.tiers.map((t) => `${t.below !== undefined ? `< ₹${t.below}` : t.upToInclusive !== undefined ? `≤ ₹${t.upToInclusive}` : "above"}: ${t.points}`).join(" · ") + " (on individual equal share)" : s.calc === "zero" ? s.zeroReason : "see contribution table"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card title="Publication contribution table" subtitle="Exact Guidelines cells. Ranges and unlisted combinations are routed to Admin/Dean review." flush>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead><tr><th>Co-authors</th><th>Contribution</th><th>Affiliation mix</th><th className="num">Factor</th></tr></thead>
            <tbody>
              {p.publication.contributionMatrix.map((c, i) => (
                <tr key={i}>
                  <td>{p.publication.coAuthorCounts.find((x) => x.key === c.coAuthors)?.label}</td>
                  <td>{p.publication.contributions.find((x) => x.key === c.contribution)?.label}</td>
                  <td className="small">{p.publication.affiliationMixes.find((x) => x.key === c.mix)?.label}</td>
                  <td className="num">{c.factor ?? <Badge tone="warn">range {c.range}</Badge>}</td>
                </tr>
              ))}
              <tr><td>None (sole author)</td><td>—</td><td>—</td><td className="num">{p.publication.soleAuthor.factor} <Pending s={p.publication.soleAuthor.signoff} /></td></tr>
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
