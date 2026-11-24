import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { emailIssues } from "@/server/services/adminQueries";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";
import { CorrectionDecision, ResendButton, ResolveIssue } from "./IssueActions";

export const metadata = { title: "Email issues" };

export default async function EmailIssuesPage() {
  await requireAdmin();
  const q = await emailIssues();
  const name = (facultyId: string | null) => (facultyId ? (q.faculty.get(facultyId)?.displayName ?? facultyId) : "—");
  return (
    <div className="stack">
      <PageHeader title="Email issues" subtitle="Provider acceptance, delivery, bounces and faculty-confirmed receipt are tracked separately." />

      <Card title="Email correction requests" subtitle="Faculty cannot change their email. Approve only after confirming directly with the faculty member." flush>
        {q.corrections.length === 0 ? (
          <div className="card-body"><Empty>No pending requests.</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Faculty</th><th>Current → requested</th><th>Explanation</th><th>Requested</th><th style={{ minWidth: 300 }}>Decision</th></tr></thead>
              <tbody>
                {q.corrections.map((c) => (
                  <tr key={c.id}>
                    <td className="strong">{name(c.facultyId)}</td>
                    <td className="small">{c.oldEmail}<br />→ <strong>{c.requestedEmail}</strong></td>
                    <td className="small">{c.explanation || "Nil"}</td>
                    <td className="small muted">{fmtDateTime(c.requestedAt)}</td>
                    <td><CorrectionDecision id={c.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Failed or bounced sends" subtitle="Latest PDF email per submission." flush>
        {q.failed.length === 0 ? (
          <div className="card-body"><Empty>No failed or bounced emails.</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Faculty</th><th>Recipient</th><th>Status</th><th>Error</th><th>When</th><th /></tr></thead>
              <tbody>
                {q.failed.map((a) => (
                  <tr key={a.id}>
                    <td className="strong">{a.submissionId ? <Link href={`/admin/submissions/${a.submissionId}`}>{name(a.facultyId)}</Link> : name(a.facultyId)}</td>
                    <td className="small">{a.recipientEmail}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td className="small">{a.errorCode ? `${a.errorCode}: ${a.errorMessage}` : a.events.at(-1)?.detail || "—"}</td>
                    <td className="small muted">{fmtDateTime(a.failedAt ?? a.bouncedAt ?? a.queuedAt)}</td>
                    <td>{a.submissionId && <ResendButton submissionId={a.submissionId} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Faculty reported “not received”" subtitle="The address was confirmed correct, or the faculty member has not answered yet." flush>
        {q.unresolved.length === 0 ? (
          <div className="card-body"><Empty>No open reports.</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Faculty</th><th>Address shown</th><th>Follow-up</th><th>Notes</th><th>Reported</th><th style={{ minWidth: 360 }} /></tr></thead>
              <tbody>
                {q.unresolved.map((r) => (
                  <tr key={r.id}>
                    <td className="strong"><Link href={`/admin/submissions/${r.submissionId}`}>{name(r.facultyId)}</Link></td>
                    <td className="small">{r.addressShown}</td>
                    <td className="small">{r.followUp === "PENDING_ANSWER" ? "Awaiting faculty answer" : "Address correct, not received"}</td>
                    <td className="small">{r.notes || "Nil"}</td>
                    <td className="small muted">{fmtDateTime(r.confirmedAt)}</td>
                    <td><div className="stack" style={{ gap: 6 }}><ResendButton submissionId={r.submissionId} /><ResolveIssue id={r.id} /></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {q.recentCorrections.length > 0 && (
        <Card title="Recently decided corrections" flush>
          <div className="table-wrap">
            <table className="table table-compact small">
              <thead><tr><th>Faculty</th><th>Requested</th><th>Decision</th><th>Reason</th><th>When</th><th /></tr></thead>
              <tbody>
                {q.recentCorrections.map((c) => (
                  <tr key={c.id}>
                    <td>{name(c.facultyId)}</td>
                    <td>{c.requestedEmail}</td>
                    <td><StatusBadge status={c.status === "APPROVED" ? "APPROVED" : "REJECTED"} /></td>
                    <td>{c.reviewReason}</td>
                    <td className="muted">{fmtDateTime(c.reviewedAt)}</td>
                    <td>{c.status === "APPROVED" && c.submissionId && <ResendButton submissionId={c.submissionId} label="Resend to new address" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
