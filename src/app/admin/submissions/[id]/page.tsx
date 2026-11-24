import { notFound } from "next/navigation";
import { requireAdmin } from "@/server/auth/session";
import { C, db } from "@/server/db";
import type { AuditEvent, Faculty, Receipt, Submission } from "@/server/domain/schemas";
import { versionsOf, viewOf } from "@/server/services/submissions";
import { attemptsFor } from "@/server/services/email";
import { exportsFor } from "@/server/services/exports";
import { designationLabel, researchStatusLabel } from "@/lib/policyView";
import { fmtDate, fmtDateTime, fmtINR } from "@/lib/format";
import { Alert, Card, PageHeader, StatusBadge } from "@/components/ui";
import { PaymentExplanation, PointsComparison } from "@/components/Points";
import { SubmissionDetail } from "@/components/SubmissionDetail";
import { CategoryAdjust, DecisionPanel, ExportButtons, LineReviewRow } from "./ReviewControls";

export const metadata = { title: "Review submission" };

export default async function AdminReview({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const sub = /^[A-Za-z0-9_.-]{1,120}$/.test(id) ? await db().get<Submission>(C.submissions, id) : null;
  if (!sub || !sub.submittedScore || !sub.submittedPoints || !sub.approvedPoints || !sub.facultySnapshot) notFound();
  const [view, faculty, attempts, exportsList, versions, receipts, audit] = await Promise.all([
    viewOf(sub),
    db().get<Faculty>(C.faculty, sub.facultyId),
    attemptsFor(sub.id),
    exportsFor(sub.id),
    versionsOf(sub.id),
    db().list<Receipt>(C.receipts, (r) => r.submissionId === sub.id),
    db().list<AuditEvent>(C.audit, (e) => e.entityId === sub.id),
  ]);
  const { policy, ay } = view;
  const f = sub.facultySnapshot;
  const editable = sub.status === "SUBMITTED" || sub.status === "UNDER_REVIEW";
  const score = sub.submittedScore;

  return (
    <div className="stack">
      <PageHeader
        title={f.displayName}
        crumbs={[{ href: "/admin/submissions", label: "Submissions" }]}
        subtitle={
          <>
            <StatusBadge status={sub.status} /> {ay.label} · version {sub.currentVersion} · policy {sub.policyVersion} · <span className="mono">{sub.id}</span>
          </>
        }
      />
      {score.warnings.length > 0 && (
        <Alert tone="warn" title={`${score.warnings.length} item(s) need Admin attention`}>
          <ul>{score.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul>
        </Alert>
      )}
      {sub.locked && <Alert tone="info">This submission is locked. Use “Reopen for amendment” to make further changes (audited).</Alert>}

      <div className="layout-side">
        <div className="stack">
          <Card title="Submitted vs approved points" subtitle="Approved values start equal to submitted values. Adjust each category independently; every change needs a reason.">
            <div className="stack">
              <CategoryAdjust submissionId={sub.id} rev={sub._rev} submitted={sub.submittedPoints} approved={sub.approvedPoints} remarks={sub.categoryRemarks ?? {}} editable={editable} />
              <PointsComparison submitted={sub.submittedPoints} approved={sub.approvedPoints} subElig={view.submitted} apprElig={view.approved} />
              {view.approved && <PaymentExplanation elig={view.approved} />}
            </div>
          </Card>

          <Card title="Score lines" subtitle="Verify each claimed activity. An override changes only that line's category." flush>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead><tr><th>Cat.</th><th>Activity</th><th /><th className="num">Submitted</th><th className="num">Approved</th><th>Verification</th><th /></tr></thead>
                <tbody>
                  {score.lines.length === 0 && <tr><td colSpan={7} className="muted">No scored lines.</td></tr>}
                  {score.lines.map((l) => (
                    <LineReviewRow key={l.lineId} submissionId={sub.id} rev={sub._rev} line={l} review={sub.lineReviews[l.lineId]} editable={editable} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <SubmissionDetail sub={sub} policy={policy} showReviews />
        </div>

        <aside className="stack sticky">
          <Card title="Decision">
            <DecisionPanel submissionId={sub.id} rev={sub._rev} status={sub.status} />
          </Card>
          <Card title="Faculty">
            <dl className="kv small">
              <dt>Designation</dt><dd>{designationLabel(policy, f.designationKey)}</dd>
              <dt>Category</dt><dd>{f.facultyCategory === "JUNIOR" ? "Junior Faculty" : "Standard"}</dd>
              <dt>Joined</dt><dd>{fmtDate(f.dateOfJoining)}</dd>
              <dt>Research status</dt><dd>{researchStatusLabel(policy, f.researchStatus)}</dd>
              <dt>Email (master)</dt><dd>{faculty?.email ?? f.email}</dd>
              <dt>Submitted</dt><dd>{fmtDateTime(sub.submittedAt)}</dd>
              {score.teachingInfo.cldCompensation !== null && Number(score.teachingInfo.cldHours) > 0 && (<><dt>CLD (separate)</dt><dd>{fmtINR(score.teachingInfo.cldCompensation)}</dd></>)}
            </dl>
          </Card>
          <Card title="PDF & email">
            <div className="stack">
              <ExportButtons submissionId={sub.id} />
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {exportsList.map((e) => <li key={e.id}><a href={`/api/exports/${e.id}`}>{e.kind.toLowerCase()} v{e.versionNumber}</a> <span className="muted">· {fmtDateTime(e.generatedAt)}</span></li>)}
              </ul>
              <table className="table table-compact small">
                <tbody>
                  {attempts.map((a) => (
                    <tr key={a.id}>
                      <td><div>{a.purpose.replace(/_/g, " ").toLowerCase()} #{a.attemptNumber}</div><div className="tiny muted">{a.recipientEmail} · {fmtDateTime(a.queuedAt)}</div>{a.errorMessage && <div className="tiny" style={{ color: "var(--bad)" }}>{a.errorCode}: {a.errorMessage}</div>}</td>
                      <td><StatusBadge status={a.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {receipts.map((r) => (
                <div key={r.id} className="tiny">
                  Faculty {r.response === "YES_RECEIVED" ? "confirmed receipt" : "reported NOT received"} · {fmtDateTime(r.confirmedAt)} · {r.followUp.replace(/_/g, " ").toLowerCase()}
                </div>
              ))}
            </div>
          </Card>
          <Card title="Messages & history">
            <ul className="timeline">
              {sub.messages.map((m) => (
                <li key={m.id} className={m.from === "ADMIN" ? "admin" : "faculty"}>
                  <div className="tiny muted">{fmtDateTime(m.at)} · {m.from === "ADMIN" ? "Admin" : "Faculty"} · {m.kind.replace(/_/g, " ").toLowerCase()}</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{m.message}</div>
                </li>
              ))}
              {versions.map((v) => (
                <li key={v.id}><div className="tiny muted">{fmtDateTime(v.createdAt)} · version {v.versionNumber}</div><div>{v.kind.replace(/_/g, " ").toLowerCase()}</div></li>
              ))}
            </ul>
            <details style={{ marginTop: 10 }}>
              <summary className="small">Audit events ({audit.length})</summary>
              <ul className="tiny" style={{ paddingLeft: 16 }}>
                {audit.sort((a, b) => a.at.localeCompare(b.at)).map((e) => <li key={e.id}>{fmtDateTime(e.at)} · {e.actorRole} · {e.action}{e.reason ? ` — ${e.reason}` : ""}</li>)}
              </ul>
            </details>
          </Card>
        </aside>
      </div>
    </div>
  );
}
