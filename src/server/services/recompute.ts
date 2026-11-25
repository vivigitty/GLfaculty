import Decimal from "decimal.js";
import { C, db } from "../db";
import type { AcademicYear, AuditEvent, EmailAttempt, Faculty, RTS, ScoreSnapshot, Submission, SubmissionContent, SubmissionVersion } from "../domain/schemas";
import { newId } from "../store/fileStore";
import { audit, SYSTEM, type Actor } from "../audit";
import { scoreSubmission, totalOf } from "../scoring/engine";
import { validateContent } from "../scoring/validate";
import { getPolicy } from "../policy/load";
import type { Policy } from "../policy/schema";
import { fitContentToPolicy } from "./policies";
import { generateExport } from "./exports";
import { emailVarsFor, sendEmail } from "./email";
import { snapshotOf, withoutBlankTeachingRows } from "./submissions";
import { UserError, nowIso, reasonRequired } from "./common";

/**
 * Policy-change recompute (owner decision 2026-11-25).
 *
 * A year's policy version may change at any time. Drafts follow immediately (policies.assignPolicyToYear).
 * Every other live record — submitted, under review, awaiting clarification or approved — keeps the version
 * it was scored under until the Admin explicitly recomputes it here. Recomputing:
 *  - re-scores the last submitted content under the year's current policy (new submission version),
 *  - resets approved R/T/S to the new submitted values, keeping line reviews only for lines whose points did not change,
 *  - reopens approved records for review (the previous approved snapshot stays in the version history),
 *  - generates a "recomputed" PDF and emails the faculty member old vs new submitted points.
 * Draft holders can be emailed their old vs new draft points. Rejected records are never touched.
 */

const RECOMPUTABLE = new Set<Submission["status"]>(["SUBMITTED", "UNDER_REVIEW", "NEEDS_CLARIFICATION", "APPROVED"]);

export type RecomputeCandidate = {
  submission: Submission;
  oldPoints: RTS;
  newPoints: RTS;
  changedLines: number;
  validationIssues: number;
};

export type DraftNotice = {
  submission: Submission;
  facultyName: string;
  oldPoints: RTS | null;
  newPoints: RTS;
  notified: boolean;
};

export type PolicyChangeSummary = {
  year: AcademicYear;
  candidates: RecomputeCandidate[];
  drafts: DraftNotice[];
};

const fmt = (p: RTS) => `R ${p.R} + T ${p.T} + S ${p.S} = ${totalOf(p)}`;

/** The content that was last submitted (faculty may be editing `content` while awaiting clarification). */
async function lastSubmittedContent(sub: Submission): Promise<SubmissionContent> {
  if (sub.status !== "NEEDS_CLARIFICATION") return sub.content;
  const versions = await db().list<SubmissionVersion>(C.submissionVersions, (v) => v.submissionId === sub.id && v.versionNumber === sub.currentVersion);
  return versions.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.content ?? sub.content;
}

function rescore(content: SubmissionContent, policy: Policy, sub: Submission, faculty: Faculty | null, ay: AcademicYear): { content: SubmissionContent; removed: string[]; score: ScoreSnapshot; issues: string[] } {
  const fitted = fitContentToPolicy(content, policy);
  const snap = sub.facultySnapshot ?? (faculty ? snapshotOf(faculty) : null);
  if (!snap) throw new UserError("Submission has no faculty snapshot.");
  const score = scoreSubmission({ content: fitted.content, policy, faculty: snap, period: { startDate: ay.startDate, endDate: ay.endDate } });
  const issues = validateContent(withoutBlankTeachingRows(fitted.content), policy, "submit").map((e) => `${e.path}: ${e.message}`);
  return { content: fitted.content, removed: fitted.removed, score, issues };
}

function changedLineCount(before: ScoreSnapshot | null, after: ScoreSnapshot): number {
  const old = new Map((before?.lines ?? []).map((l) => [l.lineId, l.points]));
  const ids = new Set([...old.keys(), ...after.lines.map((l) => l.lineId)]);
  let n = 0;
  for (const id of ids) {
    const a = old.get(id);
    const b = after.lines.find((l) => l.lineId === id)?.points;
    if (a === undefined || b === undefined || !new Decimal(a).eq(b)) n++;
  }
  return n;
}

/** Years whose live records are scored under a different version from the year's current one. */
export async function policyChangeSummaries(): Promise<PolicyChangeSummary[]> {
  const years = await db().list<AcademicYear>(C.academicYears);
  const subs = await db().list<Submission>(C.submissions);
  const faculty = new Map((await db().list<Faculty>(C.faculty)).map((f) => [f.id, f]));
  const notices = await db().list<EmailAttempt>(C.emailAttempts, (a) => a.purpose === "POLICY_DRAFT_NOTICE" && a.status !== "FAILED");
  const moves = (await db().list<AuditEvent>(C.audit, (e) => e.action === "DRAFT_POLICY_UPDATED")).sort((a, b) => b.at.localeCompare(a.at));
  const out: PolicyChangeSummary[] = [];
  for (const ay of years) {
    const stale = subs.filter((s) => s.academicYearId === ay.id && RECOMPUTABLE.has(s.status) && s.policyVersion !== ay.policyVersion);
    const draftSubs = subs.filter((s) => s.academicYearId === ay.id && s.status === "DRAFT");
    if (!stale.length && !draftSubs.length) continue;
    const policy = await getPolicy(ay.policyVersion);
    const candidates: RecomputeCandidate[] = [];
    for (const s of stale) {
      if (!s.submittedPoints) continue;
      const r = rescore(await lastSubmittedContent(s), policy, s, faculty.get(s.facultyId) ?? null, ay);
      candidates.push({ submission: s, oldPoints: s.submittedPoints, newPoints: r.score.totals, changedLines: changedLineCount(s.submittedScore, r.score), validationIssues: r.issues.length });
    }
    // Drafts already use the year's policy; list those not yet told about this version.
    const drafts: DraftNotice[] = [];
    for (const d of draftSubs) {
      const f = faculty.get(d.facultyId);
      if (!f || d.policyVersion !== ay.policyVersion) continue;
      const hasContent = d.content.teaching.length > 0 || d.content.research.length > 0 || Object.values(d.content.service.roles).some((r) => r.quantity.trim() !== "");
      if (!hasContent) continue;
      const notified = notices.some((n) => n.idempotencyKey.startsWith(`policydraft:${d.id}:${ay.policyVersion}#`));
      const lastMove = moves.find((e) => e.entityId === d.id);
      const prevVersion = (lastMove?.before as { policyVersion?: string } | undefined)?.policyVersion;
      if (!prevVersion || prevVersion === ay.policyVersion) continue; // never moved: nothing to tell
      const snap = snapshotOf(f);
      const period = { startDate: ay.startDate, endDate: ay.endDate };
      const newPoints = scoreSubmission({ content: d.content, policy, faculty: snap, period }).totals;
      let oldPoints: RTS | null = null;
      try {
        oldPoints = scoreSubmission({ content: d.content, policy: await getPolicy(prevVersion), faculty: snap, period }).totals;
      } catch {
        oldPoints = null;
      }
      drafts.push({ submission: d, facultyName: f.displayName, oldPoints, newPoints, notified });
    }
    if (candidates.length || drafts.some((d) => !d.notified)) out.push({ year: ay, candidates, drafts });
  }
  return out;
}

/** Recomputes one submission under its year's current policy. Explicit, audited and versioned. */
export async function recomputeSubmission(id: string, reason: string, actor: Actor): Promise<Submission> {
  const why = reasonRequired(reason, "recomputing points after a policy change");
  const sub0 = await db().require<Submission>(C.submissions, id);
  const ay = await db().require<AcademicYear>(C.academicYears, sub0.academicYearId);
  if (!RECOMPUTABLE.has(sub0.status)) throw new UserError(`A ${sub0.status.toLowerCase().replace(/_/g, " ")} submission cannot be recomputed.`);
  if (sub0.policyVersion === ay.policyVersion) throw new UserError("This submission already uses the year's current policy.");
  const policy = await getPolicy(ay.policyVersion);
  const faculty = await db().require<Faculty>(C.faculty, sub0.facultyId);
  const submittedContent = await lastSubmittedContent(sub0);
  const r = rescore(submittedContent, policy, sub0, faculty, ay);
  // Faculty's unsent edits (clarification) also move to the new policy.
  const working = sub0.status === "NEEDS_CLARIFICATION" ? fitContentToPolicy(sub0.content, policy) : { content: r.content, removed: [] as string[] };
  if (r.issues.length) {
    r.score.warnings.push({
      code: "RECOMPUTE_VALIDATION",
      message: `Recomputed under ${policy.version}: ${r.issues.length} field(s) do not meet the new policy's rules (${r.issues.slice(0, 3).join("; ")}${r.issues.length > 3 ? "; …" : ""}). Request clarification if needed.`,
      lineId: null,
    });
  }

  const saved = await db().transact(async (tx) => {
    const cur = await tx.require<Submission>(C.submissions, id);
    if (cur._rev !== sub0._rev) throw new UserError("This submission changed while recomputing. Reload and try again.");
    const now = nowIso();
    // Keep a line's review only if the line still exists with the same points.
    const lineReviews: Submission["lineReviews"] = {};
    for (const l of r.score.lines) {
      const prevLine = cur.submittedScore?.lines.find((x) => x.lineId === l.lineId);
      const rv = cur.lineReviews[l.lineId];
      if (rv && prevLine && new Decimal(prevLine.points).eq(l.points)) lineReviews[l.lineId] = rv;
    }
    const approved = (cat: "R" | "T" | "S") =>
      r.score.lines.filter((l) => l.category === cat).reduce((a, l) => a.add(lineReviews[l.lineId]?.approvedPoints ?? l.points), new Decimal(0)).toFixed();
    const approvedPoints: RTS = { R: approved("R"), T: approved("T"), S: approved("S") };
    const oldPoints = cur.submittedPoints;
    const status: Submission["status"] = cur.status === "NEEDS_CLARIFICATION" ? "NEEDS_CLARIFICATION" : cur.status === "SUBMITTED" ? "SUBMITTED" : "UNDER_REVIEW";
    const note = `Points recomputed under policy ${policy.version} (was ${cur.policyVersion}). Submitted: ${oldPoints ? fmt(oldPoints) : "Nil"} → ${fmt(r.score.totals)}.`;
    const next = await tx.update<Submission>(C.submissions, {
      ...cur,
      status,
      policyVersion: policy.version,
      content: working.content,
      currentVersion: cur.currentVersion + 1,
      submittedScore: r.score,
      submittedPoints: { ...r.score.totals },
      approvedPoints,
      categoryRemarks: {},
      lineReviews,
      locked: false,
      approvedAt: null,
      messages: [...cur.messages, { id: newId("msg"), at: now, from: "ADMIN", kind: "POLICY_RECOMPUTE", message: note }],
      updatedAt: now,
    });
    await tx.create<SubmissionVersion>(C.submissionVersions, {
      id: newId("ver"),
      submissionId: id,
      versionNumber: next.currentVersion,
      kind: "POLICY_RECOMPUTED",
      content: r.content,
      facultySnapshot: next.facultySnapshot ?? snapshotOf(faculty),
      score: r.score,
      submittedPoints: next.submittedPoints!,
      approvedPoints,
      createdAt: now,
      createdByRole: actor.role,
      reason: why,
    });
    await audit(tx, actor, {
      action: "SUBMISSION_RECOMPUTED",
      entityType: "submission",
      entityId: id,
      before: { status: cur.status, policyVersion: cur.policyVersion, submittedPoints: cur.submittedPoints, approvedPoints: cur.approvedPoints, categoryRemarks: cur.categoryRemarks ?? {} },
      after: { status, policyVersion: policy.version, submittedPoints: next.submittedPoints, approvedPoints, removedValues: [...r.removed, ...working.removed], validationIssues: r.issues },
      reason: why,
    });
    return next;
  });

  try {
    const exp = await generateExport(id, "RECOMPUTED", actor);
    const vars = { ...(await emailVarsFor(saved, faculty)), policy: policy.version, oldPoints: sub0.submittedPoints ? fmt(sub0.submittedPoints) : "Nil", newPoints: fmt(saved.submittedPoints!), message: "" };
    await sendEmail({ purpose: "POLICY_RECOMPUTED", to: faculty.email, vars, submissionId: id, facultyId: faculty.id, exportFile: exp, idempotencyBase: `recompute:${id}:v${saved.currentVersion}`, actor: SYSTEM });
  } catch (e) {
    console.error("[recompute] export/email failed", e);
  }
  return db().require<Submission>(C.submissions, id);
}

/** Emails a draft holder their draft points before/after the policy change (once per version). */
export async function notifyDraft(id: string, actor: Actor): Promise<EmailAttempt> {
  const summaries = await policyChangeSummaries();
  const d = summaries.flatMap((s) => s.drafts.map((x) => ({ ...x, year: s.year }))).find((x) => x.submission.id === id);
  if (!d) throw new UserError("This draft has no pending policy-change notice.");
  const faculty = await db().require<Faculty>(C.faculty, d.submission.facultyId);
  const vars = {
    ...(await emailVarsFor(d.submission, faculty)),
    policy: d.year.policyVersion,
    oldPoints: d.oldPoints ? fmt(d.oldPoints) : "Nil",
    newPoints: fmt(d.newPoints),
    message: "",
  };
  const a = await sendEmail({ purpose: "POLICY_DRAFT_NOTICE", to: faculty.email, vars, submissionId: id, facultyId: faculty.id, idempotencyBase: `policydraft:${id}:${d.year.policyVersion}`, actor });
  await db().transact(async (tx) => {
    await audit(tx, actor, { action: "DRAFT_POLICY_NOTICE_SENT", entityType: "submission", entityId: id, after: { policyVersion: d.year.policyVersion, oldPoints: d.oldPoints, newPoints: d.newPoints, emailStatus: a.status } });
  });
  return a;
}

/** Bulk entry point for the Admin page: recompute selected records and notify selected drafts. */
export async function runPolicyChange(input: { submissionIds: string[]; draftIds: string[]; reason: string }, actor: Actor): Promise<{ recomputed: number; notified: number; failures: string[] }> {
  if (!input.submissionIds.length && !input.draftIds.length) throw new UserError("Select at least one submission or draft.");
  const why = reasonRequired(input.reason, "recomputing points after a policy change");
  const failures: string[] = [];
  let recomputed = 0;
  let notified = 0;
  for (const id of input.submissionIds) {
    try {
      await recomputeSubmission(id, why, actor);
      recomputed++;
    } catch (e) {
      failures.push(`${id}: ${(e as Error).message}`);
    }
  }
  for (const id of input.draftIds) {
    try {
      await notifyDraft(id, actor);
      notified++;
    } catch (e) {
      failures.push(`${id}: ${(e as Error).message}`);
    }
  }
  return { recomputed, notified, failures };
}
