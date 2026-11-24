import { C, db } from "../db";
import type { EmailAttempt, EmailCorrection, Faculty, Receipt, Submission } from "../domain/schemas";

/** Read models for the Admin email-issue queue. */
export async function emailIssues() {
  const [attempts, receipts, corrections, faculty, subs] = await Promise.all([
    db().list<EmailAttempt>(C.emailAttempts),
    db().list<Receipt>(C.receipts),
    db().list<EmailCorrection>(C.emailCorrections),
    db().list<Faculty>(C.faculty),
    db().list<Submission>(C.submissions),
  ]);
  const fac = new Map(faculty.map((f) => [f.id, f]));
  const sub = new Map(subs.map((s) => [s.id, s]));
  // Latest export-bearing attempt per submission; flag if it failed or bounced.
  const latest = new Map<string, EmailAttempt>();
  for (const a of attempts.filter((x) => x.exportId && x.submissionId).sort((x, y) => x.queuedAt.localeCompare(y.queuedAt))) latest.set(a.submissionId!, a);
  const failed = [...latest.values()].filter((a) => a.status === "FAILED" || a.status === "BOUNCED");
  const unresolved = receipts.filter((r) => !r.resolved && r.followUp !== "CORRECTION_REQUESTED").sort((a, b) => a.confirmedAt.localeCompare(b.confirmedAt));
  const pending = corrections.filter((c) => c.status === "PENDING").sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  return {
    failed,
    unresolved,
    corrections: pending,
    recentCorrections: corrections.filter((c) => c.status !== "PENDING").sort((a, b) => (b.reviewedAt ?? "").localeCompare(a.reviewedAt ?? "")).slice(0, 20),
    faculty: fac,
    submissions: sub,
  };
}
