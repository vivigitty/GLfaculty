import { notFound } from "next/navigation";
import { requireFaculty } from "@/server/auth/session";
import { ownSubmission, previewForFaculty, viewOf } from "@/server/services/submissions";
import { isAcceptingSubmissions } from "@/server/services/academicYears";
import { attemptsFor } from "@/server/services/email";
import { exportsFor } from "@/server/services/exports";
import { appConfig } from "@/server/services/config";
import { C, db } from "@/server/db";
import type { Receipt } from "@/server/domain/schemas";
import { designationLabel, researchStatusLabel } from "@/lib/policyView";
import { fmtDateTime } from "@/lib/format";
import { Alert, Card, PageHeader, StatusBadge } from "@/components/ui";
import { PaymentExplanation, PointsComparison, SubmittedPoints } from "@/components/Points";
import { SubmissionDetail } from "@/components/SubmissionDetail";
import { SubmissionEditor } from "./SubmissionEditor";
import { ReceiptFlow } from "./ReceiptFlow";

export const metadata = { title: "Submission" };

export default async function FacultySubmissionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const { faculty } = await requireFaculty();
  const { id } = await params;
  const { submitted } = await searchParams;
  const sub = await ownSubmission(faculty.id, id).catch(() => null);
  if (!sub) notFound();
  const view = await viewOf(sub);
  const { ay, policy } = view;
  const crumbs = [{ href: "/faculty", label: "My submissions" }];

  const editable = (sub.status === "DRAFT" && isAcceptingSubmissions(ay)) || sub.status === "NEEDS_CLARIFICATION";
  if (editable) {
    const preview = await previewForFaculty(faculty, sub.id, sub.content);
    const lastClarification = [...sub.messages].reverse().find((m) => m.kind === "CLARIFICATION_REQUEST");
    return (
      <>
        <PageHeader title={`RTS submission — ${ay.label}`} crumbs={crumbs} subtitle={<><StatusBadge status={sub.status} /> Policy {sub.policyVersion}</>} />
        <SubmissionEditor
          submissionId={sub.id}
          initialRev={sub._rev}
          policy={policy}
          initialContent={sub.content}
          initialPreview={preview}
          profile={{
            name: faculty.displayName,
            designation: designationLabel(policy, faculty.designationKey),
            category: faculty.facultyCategory === "JUNIOR" ? "Junior Faculty" : "Standard Faculty",
            doj: faculty.dateOfJoining,
            email: faculty.email,
            researchStatus: researchStatusLabel(policy, faculty.researchStatus),
            doe: faculty.dateOfExit ?? null,
          }}
          ay={{ label: ay.label, startDate: ay.startDate, endDate: ay.endDate, closeAt: ay.submissionCloseAt }}
          isResubmission={sub.status === "NEEDS_CLARIFICATION"}
          clarification={sub.status === "NEEDS_CLARIFICATION" ? (lastClarification?.message ?? null) : null}
        />
      </>
    );
  }

  if (sub.status === "DRAFT") {
    return (
      <div className="stack">
        <PageHeader title={`RTS submission — ${ay.label}`} crumbs={crumbs} />
        <Alert tone="warn" title="Submission window closed">This draft can no longer be edited or submitted. Please contact the RTS Admin.</Alert>
      </div>
    );
  }

  const [attempts, exportsList, receipts, cfg] = await Promise.all([
    attemptsFor(sub.id),
    exportsFor(sub.id),
    db().list<Receipt>(C.receipts, (r) => r.submissionId === sub.id && r.facultyId === faculty.id),
    appConfig(),
  ]);
  // Internal Admin notes stay internal.
  const facultyMessages = sub.messages.filter((m) => m.kind !== "ADMIN_NOTE");
  const lastExportAttempt =[...attempts].reverse().find((a) => a.exportId && a.status !== "FAILED") ?? [...attempts].reverse().find((a) => a.exportId);
  const receipt = [...receipts].sort((a, b) => b.confirmedAt.localeCompare(a.confirmedAt)).find((r) => r.emailAttemptId === (lastExportAttempt?.id ?? null)) ?? null;

  return (
    <div className="stack">
      <PageHeader
        title={`RTS submission — ${ay.label}`}
        crumbs={crumbs}
        subtitle={
          <>
            <StatusBadge status={sub.status} /> Reference <span className="mono">{sub.id}</span> · submitted {fmtDateTime(sub.submittedAt)}
          </>
        }
      />
      {submitted && <Alert tone="ok" title="Submitted successfully">Your submission has been received. A PDF copy has been prepared and emailed to {faculty.email}.</Alert>}
      {sub.status === "APPROVED" && <Alert tone="ok" title="Review complete">The Admin approved your submission on {fmtDateTime(sub.approvedAt)}. The final PDF shows submitted and approved points.</Alert>}
      {sub.status === "REJECTED" && <Alert tone="bad" title="Submission rejected">See the messages below and contact the RTS Admin.</Alert>}

      <div className="layout-side">
        <div className="stack">
          {sub.status === "APPROVED" ? (
            <Card title="Points" subtitle="Your submitted points alongside the points approved by the Admin.">
              {sub.submittedPoints && <PointsComparison submitted={sub.submittedPoints} approved={sub.approvedPoints ?? sub.submittedPoints} subElig={view.submitted} apprElig={view.approved} />}
              {view.approved && <div style={{ marginTop: 12 }}><PaymentExplanation elig={view.approved} /></div>}
            </Card>
          ) : (
            <Card title="Points" subtitle="The points you submitted. Approved points will appear here once the Admin completes the review.">
              {sub.submittedPoints && <SubmittedPoints submitted={sub.submittedPoints} elig={view.submitted} />}
              {view.submitted && <div style={{ marginTop: 12 }}><PaymentExplanation elig={view.submitted} /></div>}
            </Card>
          )}
          <SubmissionDetail sub={sub} policy={policy} />
        </div>
        <aside className="stack sticky">
          <Card title="Email confirmation">
            {lastExportAttempt ? (
              <ReceiptFlow
                submissionId={sub.id}
                email={faculty.email}
                correctionsEnabled={cfg.features.facultyEmailCorrectionRequests}
                attemptLabel={`Sent to ${lastExportAttempt.recipientEmail} on ${fmtDateTime(lastExportAttempt.queuedAt)}${lastExportAttempt.status === "FAILED" ? " — the provider reported a failure; the Admin has been alerted." : ""}`}
                receipt={receipt ? { id: receipt.id, response: receipt.response, followUp: receipt.followUp, confirmedAt: receipt.confirmedAt, addressShown: receipt.addressShown } : null}
              />
            ) : (
              <p className="muted small">Your PDF is being prepared. Refresh in a moment.</p>
            )}
          </Card>
          {cfg.features.facultyDirectDownload && exportsList.length > 0 && (
            <Card title="Downloads">
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {exportsList.map((e) => (
                  <li key={e.id}>
                    <a href={`/api/exports/${e.id}`}>{e.kind === "FINAL" ? "Final statement" : e.kind === "INITIAL" ? "Submission statement" : "Statement"} (v{e.versionNumber})</a>
                    <span className="muted"> · {fmtDateTime(e.generatedAt)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          <Card title="Messages">
            {facultyMessages.length === 0 ? (
              <p className="muted small">No messages.</p>
            ) : (
              <ul className="timeline">
                {facultyMessages.map((m) => (
                  <li key={m.id} className={m.from === "ADMIN" ? "admin" : "faculty"}>
                    <div className="tiny muted">{fmtDateTime(m.at)} · {m.from === "ADMIN" ? "Admin" : "You"}</div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{m.message}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
