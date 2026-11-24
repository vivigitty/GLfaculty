import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { listSubmissions } from "@/server/services/submissions";
import { listYears } from "@/server/services/academicYears";
import { currentPolicy } from "@/server/services/config";
import { C, db } from "@/server/db";
import type { EmailAttempt } from "@/server/domain/schemas";
import { SUBMISSION_STATUSES } from "@/server/domain/schemas";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { fmtDateTime, fmtPoints, STATUS_LABEL } from "@/lib/format";
import { designationLabel } from "@/lib/policyView";
import { totalOf } from "@/server/scoring/engine";

export const metadata = { title: "Submissions" };

type SP = { ay?: string; status?: string; category?: string; designation?: string; q?: string; email?: string };

export default async function SubmissionsList({ searchParams }: { searchParams: Promise<SP> }) {
  await requireAdmin();
  const sp = await searchParams;
  const [years, policy] = await Promise.all([listYears(), currentPolicy()]);
  const ay = sp.ay ?? years.find((y) => !y.historicalOnly)?.id ?? "";
  let subs = await listSubmissions({ academicYearId: ay || undefined, status: sp.status || undefined, category: sp.category || undefined, designation: sp.designation || undefined, q: sp.q });
  const attempts = await db().list<EmailAttempt>(C.emailAttempts, (a) => a.exportId !== null);
  const lastEmail = new Map<string, EmailAttempt>();
  for (const a of attempts.sort((x, y) => x.queuedAt.localeCompare(y.queuedAt))) if (a.submissionId) lastEmail.set(a.submissionId, a);
  if (sp.email) subs = subs.filter((s) => (lastEmail.get(s.id)?.status ?? "NONE") === sp.email);
  subs.sort((a, b) => (a.facultySnapshot?.displayName ?? "").localeCompare(b.facultySnapshot?.displayName ?? ""));

  return (
    <div className="stack">
      <PageHeader title="Submissions" subtitle={`${subs.length} shown`} />
      <Card>
        <form className="form-grid" role="search">
          <div className="field">
            <label htmlFor="f-ay">Academic year</label>
            <select id="f-ay" name="ay" className="input" defaultValue={ay}>
              <option value="">All</option>
              {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-status">Status</label>
            <select id="f-status" name="status" className="input" defaultValue={sp.status ?? ""}>
              <option value="">All</option>
              {SUBMISSION_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-cat">Category</label>
            <select id="f-cat" name="category" className="input" defaultValue={sp.category ?? ""}>
              <option value="">All</option>
              <option value="STANDARD">Standard Faculty</option>
              <option value="JUNIOR">Junior Faculty</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-des">Designation</label>
            <select id="f-des" name="designation" className="input" defaultValue={sp.designation ?? ""}>
              <option value="">All</option>
              {policy.designations.items.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-email">Email status</label>
            <select id="f-email" name="email" className="input" defaultValue={sp.email ?? ""}>
              <option value="">All</option>
              {["SEND_ACCEPTED", "DELIVERED", "BOUNCED", "FAILED", "QUEUED", "NONE"].map((s) => <option key={s} value={s}>{STATUS_LABEL[s] ?? "No email yet"}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="f-q">Faculty name</label>
            <input id="f-q" name="q" className="input" defaultValue={sp.q ?? ""} placeholder="Search…" />
          </div>
          <div className="field" style={{ justifyContent: "flex-end" }}>
            <div className="row">
              <button className="btn btn-primary">Filter</button>
              <Link className="btn btn-ghost" href="/admin/submissions">Reset</Link>
            </div>
          </div>
        </form>
      </Card>
      <Card flush>
        {subs.length === 0 ? (
          <div className="card-body"><Empty>No submissions match these filters.</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Faculty</th><th>Designation</th><th>Year</th><th>Status</th><th className="num">Submitted R/T/S</th><th className="num">Approved total</th><th>Email</th><th>Updated</th><th /></tr>
              </thead>
              <tbody>
                {subs.map((s) => {
                  const e = lastEmail.get(s.id);
                  return (
                    <tr key={s.id}>
                      <td className="strong">{s.facultySnapshot?.displayName ?? <span className="muted">(draft)</span>}</td>
                      <td className="small">{s.facultySnapshot ? designationLabel(policy, s.facultySnapshot.designationKey) : "—"}</td>
                      <td className="small">{s.academicYearId}</td>
                      <td><StatusBadge status={s.status} /></td>
                      <td className="num small">{s.submittedPoints ? `${fmtPoints(s.submittedPoints.R)} / ${fmtPoints(s.submittedPoints.T)} / ${fmtPoints(s.submittedPoints.S)}` : "—"}</td>
                      <td className="num strong">{s.approvedPoints && s.status !== "DRAFT" ? fmtPoints(totalOf(s.approvedPoints)) : "—"}</td>
                      <td>{e ? <StatusBadge status={e.status} /> : <span className="muted small">—</span>}</td>
                      <td className="small muted">{fmtDateTime(s.updatedAt)}</td>
                      <td>{s.status !== "DRAFT" && <Link className="btn btn-sm" href={`/admin/submissions/${s.id}`}>Open</Link>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
