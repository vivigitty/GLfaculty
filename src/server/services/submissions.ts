import Decimal from "decimal.js";
import { z } from "zod";
import { C, db } from "../db";
import {
  submissionContentSchema,
  categoryRemark,
  emptyContent,
  type AcademicYear,
  type Category,
  type Faculty,
  type FacultySnapshot,
  type RTS,
  type ScoreSnapshot,
  type Submission,
  type SubmissionContent,
  type SubmissionVersion,
} from "../domain/schemas";
import { newId, type Transaction } from "../store/fileStore";
import { audit, SYSTEM, type Actor } from "../audit";
import { eligibilityAndPayment, scoreSubmission, type Eligibility } from "../scoring/engine";
import { validateContent, type FieldError } from "../scoring/validate";
import { getPolicy } from "../policy/load";
import type { Policy } from "../policy/schema";
import { isAcceptingSubmissions } from "./academicYears";
import { generateExport } from "./exports";
import { emailVarsFor, sendEmail } from "./email";
import { appConfig } from "./config";
import { env } from "../env";
import { UserError, nowIso, reasonRequired } from "./common";

const FACULTY_EDITABLE = new Set<Submission["status"]>(["DRAFT", "NEEDS_CLARIFICATION"]);
const ADMIN_REVIEWABLE = new Set<Submission["status"]>(["SUBMITTED", "UNDER_REVIEW"]);

export function snapshotOf(f: Faculty): FacultySnapshot {
  return {
    displayName: f.displayName,
    email: f.email,
    designationKey: f.designationKey,
    facultyCategory: f.facultyCategory,
    dateOfJoining: f.dateOfJoining,
    dateOfExit: f.dateOfExit ?? null,
    researchStatus: f.researchStatus,
  };
}

export type Preview = { score: ScoreSnapshot; eligibility: Eligibility; errors: FieldError[] };

function compute(content: SubmissionContent, policy: Policy, faculty: FacultySnapshot, ay: AcademicYear, mode: "draft" | "submit"): Preview {
  const period = { startDate: ay.startDate, endDate: ay.endDate };
  const score = scoreSubmission({ content, policy, faculty, period });
  return { score, eligibility: eligibilityAndPayment(score.totals, policy, faculty, period), errors: validateContent(content, policy, mode) };
}

/** Rows added in bulk but never filled in are dropped at submission rather than failing validation. */
export function withoutBlankTeachingRows(c: SubmissionContent): SubmissionContent {
  const blank = (r: SubmissionContent["teaching"][number]) =>
    [r.courseName, r.sections, r.students, r.feedback, r.notes, ...Object.values(r.hours)].every((v) => v.trim() === "");
  return { ...c, teaching: c.teaching.filter((r) => !blank(r)) };
}

function parseContent(raw: unknown): SubmissionContent {
  const res = submissionContentSchema.safeParse(raw);
  if (!res.success) throw new UserError("The form data could not be read. Reload the page and try again.");
  return res.data;
}

// ===================================================================== Faculty side

export async function facultySubmissions(facultyId: string): Promise<Submission[]> {
  return (await db().list<Submission>(C.submissions, (s) => s.facultyId === facultyId)).sort((a, b) => b.academicYearId.localeCompare(a.academicYearId));
}

/** Loads a submission only if it belongs to the signed-in faculty member. */
export async function ownSubmission(facultyId: string, id: string): Promise<Submission> {
  const sub = /^[A-Za-z0-9_.-]{1,120}$/.test(id) ? await db().get<Submission>(C.submissions, id) : null;
  if (!sub || sub.facultyId !== facultyId) throw new UserError("Submission not found.");
  return sub;
}

/**
 * A faculty member may have several records for one year: rejected ones (kept as locked history)
 * and at most one live record. Returns the live record, or the latest rejected one if none is live.
 */
export function currentSubmission<T extends Pick<Submission, "status" | "createdAt">>(records: T[]): T | null {
  const byNewest = [...records].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return byNewest.find((s) => s.status !== "REJECTED") ?? byNewest[0] ?? null;
}

export async function startSubmission(faculty: Faculty, academicYearId: string, actor: Actor): Promise<Submission> {
  const ay = await db().get<AcademicYear>(C.academicYears, academicYearId);
  if (!ay || !isAcceptingSubmissions(ay)) throw new UserError("This academic year is not open for submissions.");
  return db().transact(async (tx) => {
    const existing = await tx.list<Submission>(C.submissions, (s) => s.facultyId === faculty.id && s.academicYearId === ay.id);
    // Reuse the live record; a rejected record is final, so a fresh one is started under the year's current policy.
    const live = existing.find((s) => s.status !== "REJECTED");
    if (live) return live;
    const now = nowIso();
    const sub = await tx.create<Submission>(C.submissions, {
      id: newId("sub"),
      academicYearId: ay.id,
      facultyId: faculty.id,
      status: "DRAFT",
      policyVersion: ay.policyVersion,
      content: emptyContent(),
      declaration: null,
      currentVersion: 0,
      facultySnapshot: null,
      submittedScore: null,
      submittedPoints: null,
      approvedPoints: null,
      lineReviews: {},
      messages: [],
      adminNotes: "",
      submittedAt: null,
      approvedAt: null,
      rejectedAt: null,
      locked: false,
      createdAt: now,
      updatedAt: now,
    });
    await audit(tx, actor, {
      action: existing.length ? "SUBMISSION_RESTARTED_AFTER_REJECTION" : "SUBMISSION_STARTED",
      entityType: "submission",
      entityId: sub.id,
      after: { policyVersion: sub.policyVersion, previousRejected: existing.map((s) => s.id) },
    });
    return sub;
  });
}

export async function previewForFaculty(faculty: Faculty, id: string, rawContent: unknown, mode: "draft" | "submit" = "draft"): Promise<Preview> {
  const sub = await ownSubmission(faculty.id, id);
  const ay = await db().require<AcademicYear>(C.academicYears, sub.academicYearId);
  return compute(parseContent(rawContent), await getPolicy(sub.policyVersion), snapshotOf(faculty), ay, mode);
}

export async function saveDraft(faculty: Faculty, id: string, rev: number, rawContent: unknown, actor: Actor): Promise<{ rev: number; preview: Preview; savedAt: string }> {
  const content = parseContent(rawContent);
  const sub = await ownSubmission(faculty.id, id);
  const ay = await db().require<AcademicYear>(C.academicYears, sub.academicYearId);
  const policy = await getPolicy(sub.policyVersion);
  const preview = compute(content, policy, snapshotOf(faculty), ay, "draft");
  if (preview.errors.length) throw new UserError("Please correct the highlighted values before saving.", preview.errors);
  const saved = await db().transact(async (tx) => {
    const cur = await tx.require<Submission>(C.submissions, id);
    if (!FACULTY_EDITABLE.has(cur.status) || cur.locked) throw new UserError("This submission can no longer be edited.");
    if (cur.status === "DRAFT" && !isAcceptingSubmissions(ay)) throw new UserError("The submission window for this academic year is closed.");
    if (cur._rev !== rev) throw new UserError("This draft was saved from another window. Reload to continue.");
    const next = await tx.update<Submission>(C.submissions, { ...cur, content, updatedAt: nowIso() });
    // Drafts are not audited on every save; changes after submission are captured as versions.
    return next;
  });
  return { rev: saved._rev, preview, savedAt: saved.updatedAt };
}

async function writeVersion(tx: Transaction, sub: Submission, kind: SubmissionVersion["kind"], actor: Actor, reason: string) {
  if (!sub.submittedScore || !sub.submittedPoints || !sub.facultySnapshot) return;
  await tx.create<SubmissionVersion>(C.submissionVersions, {
    id: newId("ver"),
    submissionId: sub.id,
    versionNumber: sub.currentVersion,
    kind,
    content: sub.content,
    facultySnapshot: sub.facultySnapshot,
    score: sub.submittedScore,
    submittedPoints: sub.submittedPoints,
    approvedPoints: sub.approvedPoints ?? sub.submittedPoints,
    createdAt: nowIso(),
    createdByRole: actor.role,
    reason,
  });
}

export async function submit(
  faculty: Faculty,
  id: string,
  rev: number,
  rawContent: unknown,
  input: { declarationAccepted: boolean; responseMessage?: string },
  actor: Actor,
): Promise<Submission> {
  const content = withoutBlankTeachingRows(parseContent(rawContent));
  const sub0 = await ownSubmission(faculty.id, id);
  const ay = await db().require<AcademicYear>(C.academicYears, sub0.academicYearId);
  const policy = await getPolicy(sub0.policyVersion);
  const snap = snapshotOf(faculty);
  const preview = compute(content, policy, snap, ay, "submit");
  if (preview.errors.length) throw new UserError("Some required information is missing or invalid. Review the highlighted items.", preview.errors);
  if (!input.declarationAccepted) throw new UserError("Please confirm the declaration before submitting.", [{ path: "declaration", message: "Required." }]);
  const response = (input.responseMessage ?? "").trim().slice(0, 4000);

  const sub = await db().transact(async (tx) => {
    const cur = await tx.require<Submission>(C.submissions, id);
    if (!FACULTY_EDITABLE.has(cur.status) || cur.locked) throw new UserError("This submission has already been submitted.");
    if (cur.status === "DRAFT" && !isAcceptingSubmissions(ay)) throw new UserError("The submission window for this academic year is closed.");
    if (cur._rev !== rev) throw new UserError("This submission was changed from another window. Reload to continue.");
    const resubmission = cur.status === "NEEDS_CLARIFICATION";
    const now = nowIso();
    const totals = preview.score.totals;
    const next: Submission = {
      ...cur,
      status: "SUBMITTED",
      content,
      declaration: { accepted: true, acceptedAt: now },
      currentVersion: cur.currentVersion + 1,
      facultySnapshot: snap,
      submittedScore: preview.score,
      submittedPoints: { ...totals },
      // Approved R/T/S start equal to submitted R/T/S, category by category.
      approvedPoints: { ...totals },
      lineReviews: {},
      messages: response ? [...cur.messages, { id: newId("msg"), at: now, from: "FACULTY", kind: "FACULTY_RESPONSE", message: response }] : cur.messages,
      submittedAt: now,
      updatedAt: now,
    };
    const saved = await tx.update<Submission>(C.submissions, next);
    await writeVersion(tx, saved, resubmission ? "RESUBMITTED" : "SUBMITTED", actor, resubmission ? "Resubmitted after clarification" : "Initial submission");
    await audit(tx, actor, {
      action: resubmission ? "SUBMISSION_RESUBMITTED" : "SUBMISSION_SUBMITTED",
      entityType: "submission",
      entityId: id,
      before: resubmission ? { submittedPoints: cur.submittedPoints, approvedPoints: cur.approvedPoints } : undefined,
      after: { version: saved.currentVersion, submittedPoints: saved.submittedPoints, approvedPoints: saved.approvedPoints, policyVersion: saved.policyVersion },
    });
    return saved;
  });
  await afterSubmit(sub.id);
  return db().require<Submission>(C.submissions, sub.id);
}

/** Generates the initial PDF and emails it. Failures are recorded, never thrown to the faculty member. */
export async function afterSubmit(submissionId: string): Promise<void> {
  try {
    const sub = await db().require<Submission>(C.submissions, submissionId);
    const faculty = await db().require<Faculty>(C.faculty, sub.facultyId);
    const exp = await generateExport(submissionId, "INITIAL", SYSTEM);
    const vars = await emailVarsFor(sub, faculty);
    await sendEmail({ purpose: "INITIAL_EXPORT", to: faculty.email, vars, submissionId, facultyId: faculty.id, exportFile: exp, idempotencyBase: `initial:${submissionId}:v${sub.currentVersion}`, actor: SYSTEM });
    const cfg = await appConfig();
    const adminTo = env().ADMIN_NOTIFY_EMAIL;
    if (cfg.notifications.adminOnSubmission && adminTo) {
      await sendEmail({ purpose: "ADMIN_NOTICE", to: adminTo, vars: { ...vars, link: `${env().APP_BASE_URL}/admin/submissions/${submissionId}` }, submissionId, facultyId: null, idempotencyBase: `adminnotice:${submissionId}:v${sub.currentVersion}`, actor: SYSTEM });
    }
  } catch (e) {
    console.error("[afterSubmit] export/email failed", e);
  }
}

// ===================================================================== Admin side

export type SubmissionFilter = { academicYearId?: string; status?: string; category?: string; designation?: string; q?: string };

export async function listSubmissions(f: SubmissionFilter = {}): Promise<Submission[]> {
  const q = f.q?.trim().toLowerCase();
  const subs = await db().list<Submission>(C.submissions, (s) => {
    if (f.academicYearId && s.academicYearId !== f.academicYearId) return false;
    if (f.status && s.status !== f.status) return false;
    if (f.category && s.facultySnapshot?.facultyCategory !== f.category) return false;
    if (f.designation && s.facultySnapshot?.designationKey !== f.designation) return false;
    return true;
  });
  if (!q) return subs;
  const faculty = new Map((await db().list<Faculty>(C.faculty)).map((x) => [x.id, x]));
  return subs.filter((s) => (s.facultySnapshot?.displayName ?? faculty.get(s.facultyId)?.displayName ?? "").toLowerCase().includes(q));
}

async function adminMutate(
  id: string,
  rev: number,
  actor: Actor,
  allowed: Set<Submission["status"]>,
  fn: (cur: Submission, tx: Transaction) => Promise<{ next: Submission; action: string; before?: unknown; after?: unknown; reason?: string }>,
): Promise<Submission> {
  return db().transact(async (tx) => {
    const cur = await tx.require<Submission>(C.submissions, id);
    if (cur._rev !== rev) throw new UserError("This submission was changed by someone else. Reload and try again.");
    if (!allowed.has(cur.status)) throw new UserError(`Not allowed while the submission is ${cur.status.toLowerCase().replace(/_/g, " ")}.`);
    const r = await fn(cur, tx);
    const saved = await tx.update<Submission>(C.submissions, { ...r.next, updatedAt: nowIso() });
    await audit(tx, actor, { action: r.action, entityType: "submission", entityId: id, before: r.before, after: r.after, reason: r.reason });
    return saved;
  });
}

export async function startReview(id: string, rev: number, actor: Actor) {
  return adminMutate(id, rev, actor, new Set(["SUBMITTED"]), async (cur) => ({
    next: { ...cur, status: "UNDER_REVIEW" },
    action: "REVIEW_STARTED",
    before: { status: cur.status },
    after: { status: "UNDER_REVIEW" },
  }));
}

export async function requestClarification(id: string, rev: number, message: string, actor: Actor) {
  const msg = reasonRequired(message, "a clarification request");
  const saved = await adminMutate(id, rev, actor, ADMIN_REVIEWABLE, async (cur) => ({
    next: { ...cur, status: "NEEDS_CLARIFICATION", messages: [...cur.messages, { id: newId("msg"), at: nowIso(), from: "ADMIN", kind: "CLARIFICATION_REQUEST", message: msg }] },
    action: "CLARIFICATION_REQUESTED",
    before: { status: cur.status },
    after: { status: "NEEDS_CLARIFICATION" },
    reason: msg,
  }));
  await notifyFaculty(saved, "Clarification requested", "The RTS Admin has asked for clarification. Please sign in, review the message and resubmit.", "facultyOnClarification");
  return saved;
}

/** Sets verification status / approved points for one score line. Recomputes only that line's category. */
export async function setLineReview(
  id: string,
  rev: number,
  lineId: string,
  input: { status: "UNVERIFIED" | "VERIFIED" | "DISPUTED" | "NEEDS_EVIDENCE"; note: string; approvedPoints: string | null; reason: string },
  actor: Actor,
) {
  const parsed = z
    .object({
      status: z.enum(["UNVERIFIED", "VERIFIED", "DISPUTED", "NEEDS_EVIDENCE"]),
      note: z.string().max(2000),
      approvedPoints: z
        .string()
        .trim()
        .regex(/^(\d+(\.\d+)?)?$/, "Points must be a non-negative number.")
        .nullable()
        .transform((v) => (v === "" ? null : v)),
      reason: z.string().max(2000),
    })
    .parse(input);
  return adminMutate(id, rev, actor, ADMIN_REVIEWABLE, async (cur) => {
    const line = cur.submittedScore?.lines.find((l) => l.lineId === lineId);
    if (!line || !cur.approvedPoints) throw new UserError("Score line not found.");
    const overrides = parsed.approvedPoints !== null && !new Decimal(parsed.approvedPoints).eq(line.points);
    const prev = cur.lineReviews[lineId];
    const prevOverride = prev?.approvedPoints ?? null;
    const changesPoints = (parsed.approvedPoints ?? null) !== prevOverride;
    const reason = overrides || changesPoints ? reasonRequired(parsed.reason, "changing approved points") : parsed.reason.trim();
    const lineReviews = {
      ...cur.lineReviews,
      [lineId]: { status: parsed.status, note: parsed.note.trim(), approvedPoints: overrides ? parsed.approvedPoints : null, reason, updatedAt: nowIso() },
    };
    let approvedPoints = cur.approvedPoints;
    if (changesPoints) {
      const cat = line.category;
      const sum = cur.submittedScore!.lines
        .filter((l) => l.category === cat)
        .reduce((a, l) => a.add(lineReviews[l.lineId]?.approvedPoints ?? l.points), new Decimal(0));
      approvedPoints = { ...cur.approvedPoints, [cat]: sum.toFixed() };
    }
    return {
      next: { ...cur, status: "UNDER_REVIEW", lineReviews, approvedPoints },
      action: changesPoints ? "LINE_APPROVED_POINTS_CHANGED" : "LINE_REVIEW_UPDATED",
      before: { line: lineId, review: prev ?? null, approvedPoints: cur.approvedPoints },
      after: { line: lineId, review: lineReviews[lineId], approvedPoints },
      reason,
    };
  });
}

/** Score lines that still need Admin verification before the submission can be approved. */
export function unverifiedLines(sub: Pick<Submission, "submittedScore" | "lineReviews">) {
  return (sub.submittedScore?.lines ?? []).filter((l) => sub.lineReviews[l.lineId]?.status !== "VERIFIED");
}

/**
 * Bulk verification: sets the verification status of many lines at once (e.g. "select all → Verified"),
 * leaving each line's note and approved-points override untouched. One audit event lists every line.
 */
export async function bulkSetLineStatus(id: string, rev: number, lineIds: string[], status: "VERIFIED" | "UNVERIFIED", actor: Actor) {
  const ids = [...new Set(lineIds)];
  if (ids.length === 0) throw new UserError("Select at least one score line.");
  return adminMutate(id, rev, actor, ADMIN_REVIEWABLE, async (cur) => {
    const known = new Set((cur.submittedScore?.lines ?? []).map((l) => l.lineId));
    const unknown = ids.filter((x) => !known.has(x));
    if (unknown.length) throw new UserError("Some selected score lines no longer exist. Reload the page and try again.");
    const now = nowIso();
    const lineReviews = { ...cur.lineReviews };
    const changed: { line: string; before: string }[] = [];
    for (const lineId of ids) {
      const prev = lineReviews[lineId];
      if ((prev?.status ?? "UNVERIFIED") === status) continue;
      changed.push({ line: lineId, before: prev?.status ?? "UNVERIFIED" });
      lineReviews[lineId] = { status, note: prev?.note ?? "", approvedPoints: prev?.approvedPoints ?? null, reason: prev?.reason ?? "", updatedAt: now };
    }
    return {
      next: { ...cur, status: "UNDER_REVIEW", lineReviews },
      action: "LINE_REVIEWS_BULK_UPDATED",
      before: { lines: changed },
      after: { status, count: changed.length },
    };
  });
}

/** Adjusts one approved category (R, T or S). Submitted values and other categories are untouched. */
export async function adjustApprovedCategory(id: string, rev: number, category: Category, value: string, reason: string, actor: Actor) {
  if (!/^\d+(\.\d+)?$/.test(value.trim())) throw new UserError("Approved points must be a non-negative number.", [{ path: `approved.${category}`, message: "Enter a number." }]);
  const why = reasonRequired(reason, `changing approved ${category}`);
  return adminMutate(id, rev, actor, ADMIN_REVIEWABLE, async (cur) => {
    if (!cur.approvedPoints) throw new UserError("Nothing to adjust yet.");
    const approvedPoints: RTS = { ...cur.approvedPoints, [category]: new Decimal(value.trim()).toFixed() };
    // The reason doubles as the remark printed on the faculty's final PDF for this category.
    const categoryRemarks = { ...(cur.categoryRemarks ?? {}), [category]: why };
    return {
      next: { ...cur, status: "UNDER_REVIEW", approvedPoints, categoryRemarks },
      action: "APPROVED_CATEGORY_ADJUSTED",
      before: { category, value: cur.approvedPoints[category] },
      after: { category, value: approvedPoints[category] },
      reason: why,
    };
  });
}

export async function addAdminNote(id: string, rev: number, note: string, actor: Actor) {
  const n = reasonRequired(note, "a note");
  return adminMutate(id, rev, actor, new Set(["SUBMITTED", "UNDER_REVIEW", "NEEDS_CLARIFICATION", "APPROVED", "REJECTED"]), async (cur) => ({
    next: { ...cur, messages: [...cur.messages, { id: newId("msg"), at: nowIso(), from: "ADMIN", kind: "ADMIN_NOTE", message: n }] },
    action: "ADMIN_NOTE_ADDED",
    reason: n,
  }));
}

export async function approve(id: string, rev: number, note: string, actor: Actor): Promise<Submission> {
  const saved = await db().transact(async (tx) => {
    const cur = await tx.require<Submission>(C.submissions, id);
    if (cur._rev !== rev) throw new UserError("This submission was changed by someone else. Reload and try again.");
    if (!ADMIN_REVIEWABLE.has(cur.status)) throw new UserError("Only submitted or under-review submissions can be approved.");
    const ay = await tx.require<AcademicYear>(C.academicYears, cur.academicYearId);
    if (ay.policyVersion !== cur.policyVersion) {
      throw new UserError(`This submission was scored under ${cur.policyVersion}, but ${ay.label} now uses ${ay.policyVersion}. Recompute it (Admin → Policy changes) before approving.`);
    }
    const pending = unverifiedLines(cur);
    if (pending.length) {
      const total = cur.submittedScore?.lines.length ?? 0;
      throw new UserError(`${pending.length} of ${total} score line(s) are not verified yet. Mark every line Verified (use "Select all" for bulk verification) before approving.`);
    }
    if (cur.submittedPoints && cur.approvedPoints) {
      const missing = (["R", "T", "S"] as const).filter((k) => !new Decimal(cur.approvedPoints![k]).eq(cur.submittedPoints![k]) && !categoryRemark(cur, k));
      if (missing.length) throw new UserError(`Add a remark for approved ${missing.join(", ")} — it differs from the submitted value and the remark is shown on the faculty's final PDF.`);
    }
    const faculty = await tx.require<Faculty>(C.faculty, cur.facultyId);
    const now = nowIso();
    const msgs = note.trim() ? [...cur.messages, { id: newId("msg"), at: now, from: "ADMIN" as const, kind: "DECISION" as const, message: `Approved: ${note.trim()}` }] : cur.messages;
    const next = await tx.update<Submission>(C.submissions, { ...cur, status: "APPROVED", locked: true, approvedAt: now, facultySnapshot: snapshotOf(faculty), messages: msgs, updatedAt: now });
    await writeVersion(tx, next, "APPROVED_SNAPSHOT", actor, note.trim() || "Final approval");
    await audit(tx, actor, {
      action: "SUBMISSION_APPROVED",
      entityType: "submission",
      entityId: id,
      before: { status: cur.status, facultySnapshot: cur.facultySnapshot },
      after: { status: "APPROVED", submittedPoints: next.submittedPoints, approvedPoints: next.approvedPoints, facultySnapshot: next.facultySnapshot },
      reason: note.trim(),
    });
    return next;
  });
  await afterApprove(saved.id, actor);
  return db().require<Submission>(C.submissions, id);
}

export async function afterApprove(submissionId: string, actor: Actor): Promise<void> {
  try {
    const sub = await db().require<Submission>(C.submissions, submissionId);
    const faculty = await db().require<Faculty>(C.faculty, sub.facultyId);
    const exp = await generateExport(submissionId, "FINAL", actor);
    await sendEmail({ purpose: "FINAL_EXPORT", to: faculty.email, vars: await emailVarsFor(sub, faculty), submissionId, facultyId: faculty.id, exportFile: exp, idempotencyBase: `final:${exp.id}`, actor });
  } catch (e) {
    console.error("[afterApprove] export/email failed", e);
  }
}

export async function reject(id: string, rev: number, reason: string, actor: Actor) {
  const why = reasonRequired(reason, "rejecting a submission");
  const saved = await adminMutate(id, rev, actor, ADMIN_REVIEWABLE, async (cur) => ({
    next: { ...cur, status: "REJECTED", locked: true, rejectedAt: nowIso(), messages: [...cur.messages, { id: newId("msg"), at: nowIso(), from: "ADMIN", kind: "DECISION", message: `Rejected: ${why}` }] },
    action: "SUBMISSION_REJECTED",
    before: { status: cur.status },
    after: { status: "REJECTED" },
    reason: why,
  }));
  await notifyFaculty(saved, "Rejected", why, "facultyOnDecision");
  return saved;
}

/** Explicit amendment workflow: unlocks an approved/rejected submission for further review. */
export async function reopen(id: string, rev: number, reason: string, actor: Actor) {
  const why = reasonRequired(reason, "reopening a decided submission");
  return adminMutate(id, rev, actor, new Set(["APPROVED", "REJECTED"]), async (cur, tx) => {
    if (cur.status === "REJECTED") {
      const live = await tx.list<Submission>(C.submissions, (s) => s.id !== cur.id && s.facultyId === cur.facultyId && s.academicYearId === cur.academicYearId && s.status !== "REJECTED");
      if (live.length) throw new UserError("This faculty member has already started a new submission for this year, so the rejected one cannot be reopened.");
      const ay = await tx.require<AcademicYear>(C.academicYears, cur.academicYearId);
      if (ay.policyVersion !== cur.policyVersion) {
        throw new UserError(`This submission was scored under ${cur.policyVersion}, but ${ay.label} now uses ${ay.policyVersion}. It stays rejected; the faculty member can start a new submission instead.`);
      }
    }
    return {
      next: { ...cur, status: "UNDER_REVIEW", locked: false, approvedAt: null, rejectedAt: null },
      action: "SUBMISSION_REOPENED",
      before: { status: cur.status, approvedPoints: cur.approvedPoints },
      after: { status: "UNDER_REVIEW" },
      reason: why,
    };
  });
}

async function notifyFaculty(sub: Submission, status: string, message: string, flag: "facultyOnClarification" | "facultyOnDecision") {
  try {
    const cfg = await appConfig();
    if (!cfg.notifications[flag]) return;
    const faculty = await db().require<Faculty>(C.faculty, sub.facultyId);
    const vars = { ...(await emailVarsFor(sub, faculty)), status, message };
    await sendEmail({ purpose: "STATUS_NOTICE", to: faculty.email, vars, submissionId: sub.id, facultyId: faculty.id, idempotencyBase: `notice:${sub.id}:${sub._rev}`, actor: SYSTEM });
  } catch (e) {
    console.error("[notify] failed", e);
  }
}

// ===================================================================== Views

export type SubmissionView = {
  submission: Submission;
  ay: AcademicYear;
  policy: Policy;
  submitted: Eligibility | null;
  approved: Eligibility | null;
};

export async function viewOf(sub: Submission): Promise<SubmissionView> {
  const ay = await db().require<AcademicYear>(C.academicYears, sub.academicYearId);
  const policy = await getPolicy(sub.policyVersion);
  const period = { startDate: ay.startDate, endDate: ay.endDate };
  const snap = sub.facultySnapshot;
  return {
    submission: sub,
    ay,
    policy,
    submitted: snap && sub.submittedPoints ? eligibilityAndPayment(sub.submittedPoints, policy, snap, period) : null,
    approved: snap && sub.approvedPoints ? eligibilityAndPayment(sub.approvedPoints, policy, snap, period) : null,
  };
}

export async function versionsOf(submissionId: string): Promise<SubmissionVersion[]> {
  return (await db().list<SubmissionVersion>(C.submissionVersions, (v) => v.submissionId === submissionId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
