import Link from "next/link";
import { requireFaculty } from "@/server/auth/session";
import { currentSubmission, facultySubmissions } from "@/server/services/submissions";
import { isAcceptingSubmissions, listYears } from "@/server/services/academicYears";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtPoints } from "@/lib/format";
import { totalOf } from "@/server/scoring/engine";
import { StartButton } from "./StartButton";

export const metadata = { title: "My submissions" };

export default async function FacultyHome() {
  const { faculty } = await requireFaculty();
  const [subs, years] = await Promise.all([facultySubmissions(faculty.id), listYears()]);
  const open = years.filter((y) => isAcceptingSubmissions(y));
  const yearLabel = new Map(years.map((y) => [y.id, y.label]));

  return (
    <div className="stack page-narrow" style={{ margin: "0 auto" }}>
      <PageHeader title={`Welcome, ${faculty.displayName}`} subtitle="Record your Research, Teaching and Service activity for the year and submit it for review." />

      <Card title="Open for submission">
        {open.length === 0 ? (
          <p className="muted">No academic year is open for submissions right now.</p>
        ) : (
          <div className="stack">
            {open.map((y) => {
              const current = currentSubmission(subs.filter((s) => s.academicYearId === y.id));
              const existing = current && current.status !== "REJECTED" ? current : null;
              return (
                <div key={y.id} className="row-between">
                  <div>
                    <div className="strong">{y.label}</div>
                    <div className="small muted">
                      Reporting period {fmtDate(y.startDate)} – {fmtDate(y.endDate)} · submissions close {fmtDate(y.submissionCloseAt)}
                    </div>
                    {current?.status === "REJECTED" && (
                      <div className="small" style={{ color: "var(--warn)" }}>Your earlier submission was rejected. You can start a new one; the rejected record stays in your history below.</div>
                    )}
                  </div>
                  {existing ? (
                    <Link className="btn btn-primary" href={`/faculty/submissions/${existing.id}`}>
                      {existing.status === "DRAFT" ? "Continue draft" : existing.status === "NEEDS_CLARIFICATION" ? "Respond to clarification" : "View submission"}
                    </Link>
                  ) : (
                    <StartButton academicYearId={y.id} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="My submissions" flush>
        {subs.length === 0 ? (
          <div className="card-body"><Empty>You have not started a submission yet.</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Academic year</th><th>Status</th><th>Policy</th><th className="num">Submitted total</th><th className="num">Approved total</th><th>Last updated</th><th /></tr>
              </thead>
              <tbody>
                {subs.map((s) => (
                  <tr key={s.id}>
                    <td className="strong">{yearLabel.get(s.academicYearId) ?? s.academicYearId}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td className="small mono">{s.policyVersion}</td>
                    <td className="num">{s.submittedPoints ? fmtPoints(totalOf(s.submittedPoints)) : "—"}</td>
                    <td className="num">{s.approvedPoints && s.status === "APPROVED" ? fmtPoints(totalOf(s.approvedPoints)) : s.status === "REJECTED" ? "—" : <span className="muted small">after review</span>}</td>
                    <td className="small muted">{fmtDateTime(s.updatedAt)}</td>
                    <td><Link href={`/faculty/submissions/${s.id}`}>Open</Link></td>
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
