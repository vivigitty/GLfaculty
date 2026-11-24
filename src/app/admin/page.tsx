import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { listYears, isAcceptingSubmissions } from "@/server/services/academicYears";
import { listSubmissions } from "@/server/services/submissions";
import { listFaculty } from "@/server/services/faculty";
import { emailIssues } from "@/server/services/adminQueries";
import { Card, Empty, PageHeader, Stat, StatusBadge } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtPoints } from "@/lib/format";
import { totalOf } from "@/server/scoring/engine";

export const metadata = { title: "Admin dashboard" };

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  await requireAdmin();
  const years = (await listYears()).filter((y) => !y.historicalOnly);
  const { ay: ayParam } = await searchParams;
  const ay = years.find((y) => y.id === ayParam) ?? years.find((y) => isAcceptingSubmissions(y)) ?? years[0];
  if (!ay) {
    return (
      <>
        <PageHeader title="Dashboard" />
        <Empty>No academic year is configured. <Link href="/admin/academic-years">Create one</Link>.</Empty>
      </>
    );
  }
  const [subs, faculty, issues] = await Promise.all([listSubmissions({ academicYearId: ay.id }), listFaculty(), emailIssues()]);
  const count = (s: string) => subs.filter((x) => x.status === s).length;
  const active = faculty.filter((f) => f.active);
  // A faculty member whose only record was rejected has not (re)started yet.
  const notStarted = active.filter((f) => !subs.some((s) => s.facultyId === f.id && s.status !== "REJECTED")).length;
  const queue = subs.filter((s) => s.status === "SUBMITTED" || s.status === "UNDER_REVIEW").sort((a, b) => (a.submittedAt ?? "").localeCompare(b.submittedAt ?? ""));
  const q = (status: string) => `/admin/submissions?ay=${ay.id}&status=${status}`;

  return (
    <div className="stack">
      <PageHeader
        title="Dashboard"
        subtitle={`${ay.label} · submissions ${isAcceptingSubmissions(ay) ? "open" : "closed"} (${fmtDate(ay.submissionOpenAt)} – ${fmtDate(ay.submissionCloseAt)})`}
        actions={
          years.length > 1 && (
            <form className="row">
              <label htmlFor="ay" className="small muted">Year</label>
              <select id="ay" name="ay" className="input" defaultValue={ay.id} style={{ width: 160 }}>
                {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
              </select>
              <button className="btn btn-sm">Go</button>
            </form>
          )
        }
      />
      <div className="grid-4">
        <Stat label="Awaiting review" value={count("SUBMITTED")} href={q("SUBMITTED")} sub="Submitted, not yet opened" />
        <Stat label="Under review" value={count("UNDER_REVIEW")} href={q("UNDER_REVIEW")} />
        <Stat label="Needs clarification" value={count("NEEDS_CLARIFICATION")} href={q("NEEDS_CLARIFICATION")} sub="Waiting on faculty" />
        <Stat label="Approved" value={count("APPROVED")} href={q("APPROVED")} sub={count("REJECTED") ? `${count("REJECTED")} rejected` : undefined} />
        <Stat label="Drafts" value={count("DRAFT")} href={q("DRAFT")} />
        <Stat label="Not started" value={notStarted} sub={`of ${active.length} active faculty`} href="/admin/faculty" />
        <Stat label="Email issues" value={issues.unresolved.length + issues.failed.length} sub="Failed, bounced or not received" href="/admin/email-issues" />
        <Stat label="Email corrections" value={issues.corrections.length} sub="Pending Admin decision" href="/admin/email-issues" />
      </div>
      <Card title="Review queue" subtitle="Oldest first" flush>
        {queue.length === 0 ? (
          <div className="card-body"><Empty>Nothing waiting for review.</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Faculty</th><th>Status</th><th className="num">Submitted total</th><th>Review flags</th><th>Submitted</th><th /></tr></thead>
              <tbody>
                {queue.map((s) => (
                  <tr key={s.id}>
                    <td className="strong">{s.facultySnapshot?.displayName}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td className="num">{s.submittedPoints ? fmtPoints(totalOf(s.submittedPoints)) : "—"}</td>
                    <td>{s.submittedScore?.warnings.length ? <span className="badge badge-warn">{s.submittedScore.warnings.length}</span> : <span className="muted">—</span>}</td>
                    <td className="small muted">{fmtDateTime(s.submittedAt)}</td>
                    <td><Link className="btn btn-sm" href={`/admin/submissions/${s.id}`}>Review</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
