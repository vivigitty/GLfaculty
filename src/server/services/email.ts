import crypto from "node:crypto";
import { C, db } from "../db";
import type { AcademicYear, EmailAttempt, EmailCorrection, ExportFile, Faculty, Receipt, Submission } from "../domain/schemas";
import { newId } from "../store/fileStore";
import { audit, SYSTEM, type Actor } from "../audit";
import { emailProvider } from "../email/provider";
import { env } from "../env";
import { appConfig, renderTemplate } from "./config";
import { UserError, normalizeEmail, nowIso, reasonRequired } from "./common";

type Purpose = EmailAttempt["purpose"];

/**
 * Sends one email, recording every attempt as its own record.
 * Transient failures are retried up to `maxAutomaticAttempts`; permanent ones stop.
 * A successful API/SMTP response is recorded as SEND_ACCEPTED — never DELIVERED.
 */
export async function sendEmail(opts: {
  purpose: Purpose;
  to: string;
  vars: Record<string, string>;
  submissionId: string | null;
  facultyId: string | null;
  exportFile?: ExportFile | null;
  idempotencyBase: string;
  actor: Actor;
}): Promise<EmailAttempt> {
  const cfg = await appConfig();
  const tpl = cfg.email.templates[opts.purpose];
  if (!tpl) throw new Error(`No email template for ${opts.purpose}`);
  const subject = renderTemplate(tpl.subject, opts.vars);
  const text = renderTemplate(tpl.body, opts.vars);
  const provider = emailProvider();
  const attachment = opts.exportFile
    ? [{ filename: opts.exportFile.fileName, content: await db().readFile(opts.exportFile.storageKey), contentType: "application/pdf" }]
    : undefined;

  // Idempotency: never repeat a send that was already accepted for the same key.
  const prior = await db().list<EmailAttempt>(C.emailAttempts, (a) => a.idempotencyKey.startsWith(`${opts.idempotencyBase}#`));
  const accepted = prior.find((a) => a.status !== "FAILED");
  if (accepted) return accepted;
  let attemptNumber = prior.length;

  let last: EmailAttempt | null = null;
  for (let i = 0; i < cfg.email.maxAutomaticAttempts; i++) {
    attemptNumber++;
    const key = `${opts.idempotencyBase}#${attemptNumber}`;
    const queued = await db().transact(async (tx) => {
      const a = await tx.create<EmailAttempt>(C.emailAttempts, {
        id: newId("eml"),
        submissionId: opts.submissionId,
        exportId: opts.exportFile?.id ?? null,
        facultyId: opts.facultyId,
        purpose: opts.purpose,
        recipientEmail: opts.to,
        subject,
        attemptNumber,
        idempotencyKey: key,
        provider: provider.name,
        status: "QUEUED",
        providerMessageId: null,
        errorCode: null,
        errorMessage: null,
        queuedAt: nowIso(),
        acceptedAt: null,
        deliveredAt: null,
        bouncedAt: null,
        failedAt: null,
        events: [{ type: "QUEUED", at: nowIso(), detail: "" }],
      });
      await audit(tx, opts.actor, { action: "EMAIL_QUEUED", entityType: "emailAttempt", entityId: a.id, after: { purpose: a.purpose, to: a.recipientEmail, attemptNumber } });
      return a;
    });
    let res;
    try {
      res = await provider.send({ to: opts.to, subject, text, attachments: attachment, idempotencyKey: key });
    } catch (e) {
      res = { accepted: false, errorCode: "PROVIDER_EXCEPTION", errorMessage: (e as Error).message, permanent: false };
    }
    last = await db().transact(async (tx) => {
      const cur = await tx.require<EmailAttempt>(C.emailAttempts, queued.id);
      const at = nowIso();
      const next: EmailAttempt = res.accepted
        ? { ...cur, status: "SEND_ACCEPTED", providerMessageId: res.providerMessageId ?? null, acceptedAt: at, events: [...cur.events, { type: "SEND_ACCEPTED", at, detail: res.providerMessageId ?? "" }] }
        : { ...cur, status: "FAILED", errorCode: res.errorCode ?? "UNKNOWN", errorMessage: res.errorMessage ?? "", failedAt: at, events: [...cur.events, { type: "FAILED", at, detail: `${res.errorCode ?? ""} ${res.errorMessage ?? ""}`.trim() }] };
      const saved = await tx.update<EmailAttempt>(C.emailAttempts, next);
      await audit(tx, SYSTEM, { action: res.accepted ? "EMAIL_SEND_ACCEPTED" : "EMAIL_FAILED", entityType: "emailAttempt", entityId: saved.id, after: { status: saved.status, errorCode: saved.errorCode } });
      return saved;
    });
    if (res.accepted || res.permanent) break;
  }
  if (!last) throw new Error("No email attempt made");
  return last;
}

export async function emailVarsFor(sub: Submission, faculty: Faculty): Promise<Record<string, string>> {
  const ay = await db().get<AcademicYear>(C.academicYears, sub.academicYearId);
  return {
    name: faculty.displayName,
    year: ay?.label ?? sub.academicYearId,
    reference: sub.id,
    link: `${env().APP_BASE_URL}/faculty/submissions/${sub.id}`,
    status: "",
    message: "",
  };
}

export async function latestExport(submissionId: string): Promise<ExportFile | null> {
  const list = await db().list<ExportFile>(C.exports, (e) => e.submissionId === submissionId);
  return list.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))[0] ?? null;
}

export async function attemptsFor(submissionId: string): Promise<EmailAttempt[]> {
  return (await db().list<EmailAttempt>(C.emailAttempts, (a) => a.submissionId === submissionId)).sort((a, b) => a.queuedAt.localeCompare(b.queuedAt));
}

/** Admin resend of the latest PDF to the current master email. Always a new attempt. */
export async function resendLatestExport(submissionId: string, actor: Actor): Promise<EmailAttempt> {
  const sub = await db().require<Submission>(C.submissions, submissionId);
  const faculty = await db().require<Faculty>(C.faculty, sub.facultyId);
  const exp = await latestExport(submissionId);
  if (!exp) throw new UserError("No PDF has been generated for this submission yet.");
  return sendEmail({
    purpose: "RESEND_EXPORT",
    to: faculty.email,
    vars: await emailVarsFor(sub, faculty),
    submissionId,
    facultyId: faculty.id,
    exportFile: exp,
    idempotencyBase: `resend:${exp.id}:${crypto.randomBytes(6).toString("hex")}`,
    actor,
  });
}

// ------------------------------------------------------------------ Provider webhooks
export function verifyWebhookSignature(rawBody: string, signature: string | null): boolean {
  const secret = env().EMAIL_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.replace(/^sha256=/, ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Applies a delivered/bounced event. Idempotent: replays are ignored. */
export async function applyProviderEvent(evt: { providerMessageId: string; event: "delivered" | "bounced"; detail?: string; eventId: string }): Promise<"applied" | "duplicate" | "unknown"> {
  return db().transact(async (tx) => {
    const [a] = await tx.list<EmailAttempt>(C.emailAttempts, (x) => x.providerMessageId === evt.providerMessageId);
    if (!a) return "unknown";
    if (a.events.some((e) => e.detail.startsWith(`[${evt.eventId}]`))) return "duplicate";
    const at = nowIso();
    const type = evt.event === "delivered" ? "DELIVERED" : "BOUNCED";
    const next: EmailAttempt = {
      ...a,
      status: evt.event === "bounced" ? "BOUNCED" : a.status === "BOUNCED" ? "BOUNCED" : "DELIVERED",
      deliveredAt: evt.event === "delivered" ? at : a.deliveredAt,
      bouncedAt: evt.event === "bounced" ? at : a.bouncedAt,
      events: [...a.events, { type, at, detail: `[${evt.eventId}] ${evt.detail ?? ""}`.trim() }],
    };
    await tx.update<EmailAttempt>(C.emailAttempts, next);
    await audit(tx, SYSTEM, { action: `EMAIL_${type}`, entityType: "emailAttempt", entityId: a.id, after: { status: next.status } });
    return "applied";
  });
}

// ------------------------------------------------------------------ Faculty receipt confirmation
async function ownSubmission(facultyId: string, submissionId: string): Promise<Submission> {
  const sub = await db().get<Submission>(C.submissions, submissionId);
  if (!sub || sub.facultyId !== facultyId) throw new UserError("Submission not found.");
  return sub;
}

export async function confirmReceipt(faculty: Faculty, submissionId: string, response: "YES_RECEIVED" | "NO_NOT_RECEIVED", actor: Actor): Promise<Receipt> {
  await ownSubmission(faculty.id, submissionId);
  const attempts = await attemptsFor(submissionId);
  const lastExportAttempt = [...attempts].reverse().find((a) => a.exportId);
  return db().transact(async (tx) => {
    const r = await tx.create<Receipt>(C.receipts, {
      id: newId("rcp"),
      submissionId,
      facultyId: faculty.id,
      emailAttemptId: lastExportAttempt?.id ?? null,
      response,
      addressShown: faculty.email,
      followUp: response === "YES_RECEIVED" ? "NONE" : "PENDING_ANSWER",
      notes: "",
      confirmedAt: nowIso(),
      resolved: response === "YES_RECEIVED",
      resolvedAt: response === "YES_RECEIVED" ? nowIso() : null,
      resolutionNote: "",
    });
    await audit(tx, actor, { action: response === "YES_RECEIVED" ? "FACULTY_CONFIRMED_RECEIPT" : "FACULTY_REPORTED_NOT_RECEIVED", entityType: "receipt", entityId: r.id, after: { addressShown: r.addressShown, emailAttemptId: r.emailAttemptId } });
    return r;
  });
}

export async function answerNotReceived(
  faculty: Faculty,
  receiptId: string,
  answer: { addressCorrect: true; notes: string } | { addressCorrect: false; requestedEmail: string; explanation: string },
  actor: Actor,
): Promise<{ receipt: Receipt; correction: EmailCorrection | null }> {
  const cfg = await appConfig();
  return db().transact(async (tx) => {
    const r = await tx.require<Receipt>(C.receipts, receiptId);
    if (r.facultyId !== faculty.id) throw new UserError("Not found.");
    if (r.followUp !== "PENDING_ANSWER") throw new UserError("This report has already been answered.");
    if (answer.addressCorrect) {
      const next = await tx.update<Receipt>(C.receipts, { ...r, followUp: "ADDRESS_CORRECT_NOT_RECEIVED", notes: answer.notes.slice(0, 2000) });
      await audit(tx, actor, { action: "EMAIL_ISSUE_RAISED", entityType: "receipt", entityId: r.id, after: { followUp: next.followUp } });
      return { receipt: next, correction: null };
    }
    if (!cfg.features.facultyEmailCorrectionRequests) throw new UserError("Email correction requests are disabled; please contact the RTS Admin.");
    const requested = normalizeEmail(answer.requestedEmail);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(requested)) throw new UserError("Enter a valid email address.", [{ path: "requestedEmail", message: "Enter a valid email address." }]);
    if (requested.toLowerCase() === faculty.email.toLowerCase()) throw new UserError("That is the address we already have. Choose “address is correct” instead.");
    const correction = await tx.create<EmailCorrection>(C.emailCorrections, {
      id: newId("ecr"),
      facultyId: faculty.id,
      submissionId: r.submissionId,
      oldEmail: faculty.email,
      requestedEmail: requested,
      explanation: answer.explanation.slice(0, 2000),
      status: "PENDING",
      requestedAt: nowIso(),
      reviewedAt: null,
      reviewReason: "",
    });
    const next = await tx.update<Receipt>(C.receipts, { ...r, followUp: "CORRECTION_REQUESTED" });
    await audit(tx, actor, { action: "EMAIL_CORRECTION_REQUESTED", entityType: "emailCorrection", entityId: correction.id, after: { requestedEmail: requested } });
    return { receipt: next, correction };
  });
}

/** Admin decision on a faculty email-correction request. Faculty confirmation is sufficient verification. */
export async function decideCorrection(id: string, approve: boolean, reason: string, actor: Actor): Promise<EmailCorrection> {
  const why = reasonRequired(reason, approve ? "approving the correction" : "rejecting the correction");
  return db().transact(async (tx) => {
    const c = await tx.require<EmailCorrection>(C.emailCorrections, id);
    if (c.status !== "PENDING") throw new UserError("This request has already been decided.");
    const next = await tx.update<EmailCorrection>(C.emailCorrections, { ...c, status: approve ? "APPROVED" : "REJECTED", reviewedAt: nowIso(), reviewReason: why });
    if (approve) {
      const f = await tx.require<Faculty>(C.faculty, c.facultyId);
      await tx.update<Faculty>(C.faculty, { ...f, email: c.requestedEmail, updatedAt: nowIso() });
      await audit(tx, actor, { action: "FACULTY_EMAIL_CORRECTED", entityType: "faculty", entityId: f.id, before: { email: f.email }, after: { email: c.requestedEmail }, reason: why });
    }
    await audit(tx, actor, { action: approve ? "EMAIL_CORRECTION_APPROVED" : "EMAIL_CORRECTION_REJECTED", entityType: "emailCorrection", entityId: id, reason: why });
    return next;
  });
}

export async function resolveReceiptIssue(id: string, note: string, actor: Actor): Promise<Receipt> {
  const why = reasonRequired(note, "resolving the issue");
  return db().transact(async (tx) => {
    const r = await tx.require<Receipt>(C.receipts, id);
    const next = await tx.update<Receipt>(C.receipts, { ...r, resolved: true, resolvedAt: nowIso(), resolutionNote: why });
    await audit(tx, actor, { action: "EMAIL_ISSUE_RESOLVED", entityType: "receipt", entityId: id, reason: why });
    return next;
  });
}
