import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import type { AcademicYear, AuditEvent, Submission } from "@/server/domain/schemas";

/**
 * End-to-end service workflow against a temporary YAML data directory:
 * auth → draft → submit → PDF + email → review → approve → receipt flows → backup/restore.
 */

let dir: string;
const ADMIN = { role: "ADMIN" as const, ref: "admin" };

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "rts-wf-"));
  process.env.DATA_DIR = dir;
  process.env.EMAIL_PROVIDER = "outbox";
  process.env.EMAIL_WEBHOOK_SECRET = "whsec_test";
  process.env.ADMIN_LOGIN_USERNAME = "admin";
  process.env.ADMIN_LOGIN_PASSWORD_HASH = await bcrypt.hash("correct horse battery", 4);
  const { db } = await import("@/server/db");
  const { seed } = await import("@/server/maintenance");
  await seed(db(), () => undefined);
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function mods() {
  return {
    ...(await import("@/server/db")),
    fac: await import("@/server/services/faculty"),
    subs: await import("@/server/services/submissions"),
    email: await import("@/server/services/email"),
    auth: await import("@/server/auth/core"),
    rl: await import("@/server/auth/rateLimit"),
    exp: await import("@/server/services/exports"),
    pay: await import("@/server/services/payments"),
    maint: await import("@/server/maintenance"),
  };
}

async function newFaculty(email: string, extra: Record<string, unknown> = {}) {
  const { fac } = await mods();
  const f = await fac.createFaculty(
    { displayName: `Prof ${email}`, email, designationKey: "ASSISTANT_PROFESSOR", dateOfJoining: "2019-01-01", researchStatus: "RESEARCH_ACTIVE", employeeId: "", dateOfExit: "", active: true, ...extra },
    ADMIN,
  );
  const { code, faculty } = await fac.issueAccessCode(f.id, ADMIN);
  return { faculty, code };
}

type Vals = Record<string, string | boolean | null>;
const sampleContent = () => ({
  teaching: [{ id: "c1", courseName: "Analytics", courseType: "CORE", sections: "2", students: "120", feedback: "", hours: { pgpm: "100", cld: "10" }, notes: "" }],
  research: [
    { id: "r1", sectionKey: "CASE", values: <Vals>{ title: "A case", caseType: "INTERNATIONAL", repository: "The Case Centre", publicationDate: null, referenceNumber: null } },
    { id: "r2", sectionKey: "GRANT", values: <Vals>{ title: "Grant", grantType: "EXTERNAL_RESEARCH", sponsor: "DST", totalAmount: "600000", participatingFaculty: "3", sanctionDate: null, reference: null } },
  ],
  // Policy 2025-26.v2: 10 empirical-study groups × 0.3 = 3, Area Chair = 10 → S 13.
  service: { roles: { EMPIRICAL_GUIDANCE: { quantity: "10", description: "Capstone groups" }, AREA_CHAIR: { quantity: "1", description: "" } }, disclosures: { GL_STAFF_PHD_GUIDANCE: "2" } },
  facultyNotes: "",
});

describe("authentication", () => {
  it("admin login works only with the configured hash", async () => {
    const { auth, rl } = await mods();
    rl.resetRateLimits();
    expect((await auth.loginAdmin("admin", "wrong", "1.1.1.1")).ok).toBe(false);
    const ok = await auth.loginAdmin("admin", "correct horse battery", "1.1.1.2");
    expect(ok.ok).toBe(true);
  });

  it("faculty codes are unique, hashed, rate-limited and revocable", async () => {
    const { auth, rl, db, C, fac } = await mods();
    rl.resetRateLimits();
    const a = await newFaculty("auth.a@example.edu");
    const b = await newFaculty("auth.b@example.edu");
    expect(a.code).not.toBe(b.code);
    const stored = await db().require<{ id: string; _rev: number; access: { secretHash: string } }>(C.faculty, a.faculty.id);
    expect(stored.access.secretHash).not.toContain(a.code.replace(/-/g, ""));
    expect(JSON.stringify(stored)).not.toContain(a.code);

    // B's code does not open A's record; error is generic.
    const cross = await auth.loginFaculty(a.faculty.id, b.code, "2.2.2.2");
    expect(cross).toEqual({ ok: false, error: auth.GENERIC_LOGIN_ERROR });
    const good = await auth.loginFaculty(a.faculty.id, a.code.toLowerCase(), "2.2.2.3");
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect((await auth.resolveSession(good.token))?.faculty?.id).toBe(a.faculty.id);
    expect(await auth.resolveSession(good.token.slice(0, -2) + "xx")).toBeNull();

    // Regeneration ends existing sessions and invalidates the old code.
    const regen = await fac.issueAccessCode(a.faculty.id, ADMIN);
    expect(await auth.resolveSession(good.token)).toBeNull();
    expect((await auth.loginFaculty(a.faculty.id, a.code, "2.2.2.4")).ok).toBe(false);
    expect((await auth.loginFaculty(a.faculty.id, regen.code, "2.2.2.5")).ok).toBe(true);

    // Revocation.
    await fac.revokeAccess(a.faculty.id, "left institute", ADMIN);
    expect((await auth.loginFaculty(a.faculty.id, regen.code, "2.2.2.6")).ok).toBe(false);

    // Rate limit after 5 failures, even with the right code afterwards.
    for (let i = 0; i < 5; i++) await auth.loginFaculty(b.faculty.id, "WRONG-CODE", "3.3.3.3");
    expect(await auth.loginFaculty(b.faculty.id, b.code, "3.3.3.4")).toEqual({ ok: false, error: auth.LOCKED_ERROR });
    rl.resetRateLimits();
  });
});

describe("submission lifecycle", () => {
  it("draft → submit → review → approve with independent submitted/approved R/T/S", async () => {
    const { db, C, subs, email, exp } = await mods();
    const { faculty } = await newFaculty("life@example.edu");
    const actor = { role: "FACULTY" as const, ref: faculty.id };
    const draft = await subs.startSubmission(faculty, "AY2025-26", actor);
    expect(draft.status).toBe("DRAFT");
    // Same year → same record.
    expect((await subs.startSubmission(faculty, "AY2025-26", actor)).id).toBe(draft.id);

    const saved = await subs.saveDraft(faculty, draft.id, draft._rev, sampleContent(), actor);
    expect(saved.preview.score.totals).toEqual({ R: "35", T: "100", S: "13" });

    // Missing declaration is rejected.
    await expect(subs.submit(faculty, draft.id, saved.rev, sampleContent(), { declarationAccepted: false }, actor)).rejects.toThrow(/declaration/);
    const sub = await subs.submit(faculty, draft.id, saved.rev, sampleContent(), { declarationAccepted: true }, actor);
    expect(sub.status).toBe("SUBMITTED");
    expect(sub.submittedPoints).toEqual({ R: "35", T: "100", S: "13" });
    expect(sub.approvedPoints).toEqual(sub.submittedPoints);

    // Initial PDF generated and emailed; acceptance is not delivery.
    const exports = await exp.exportsFor(sub.id);
    expect(exports.map((e) => e.kind)).toEqual(["INITIAL"]);
    const pdf = await db().readFile(exports[0]!.storageKey);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(crypto.createHash("sha256").update(pdf).digest("hex")).toBe(exports[0]!.checksum);
    const attempts = await email.attemptsFor(sub.id);
    expect(attempts.map((a) => [a.purpose, a.status])).toEqual([["INITIAL_EXPORT", "SEND_ACCEPTED"]]);
    expect(attempts[0]!.deliveredAt).toBeNull();

    // Faculty can no longer edit.
    await expect(subs.saveDraft(faculty, sub.id, sub._rev, sampleContent(), actor)).rejects.toThrow(/no longer be edited/);

    // Admin adjusts approved R only; reason mandatory.
    await expect(subs.adjustApprovedCategory(sub.id, sub._rev, "R", "30", "", ADMIN)).rejects.toThrow(/reason/i);
    const adj = await subs.adjustApprovedCategory(sub.id, sub._rev, "R", "30", "Case repository not verified", ADMIN);
    expect(adj.approvedPoints).toEqual({ R: "30", T: "100", S: "13" });
    expect(adj.submittedPoints).toEqual({ R: "35", T: "100", S: "13" });
    expect(adj.status).toBe("UNDER_REVIEW");

    // Line-level override recomputes only that category (S).
    const lr = await subs.setLineReview(sub.id, adj._rev, "S:EMPIRICAL_GUIDANCE", { status: "VERIFIED", note: "No evidence of groups", approvedPoints: "0", reason: "Guidance not evidenced" }, ADMIN);
    expect(lr.approvedPoints).toEqual({ R: "30", T: "100", S: "10" });
    expect(lr.submittedScore?.totals).toEqual({ R: "35", T: "100", S: "13" });

    // Stale revision is rejected.
    await expect(subs.adjustApprovedCategory(sub.id, adj._rev, "T", "90", "x-stale", ADMIN)).rejects.toThrow(/changed by someone else/);

    // Approval requires every score line to be verified; bulk verification covers the rest.
    await expect(subs.approve(lr.id, lr._rev, "Reviewed", ADMIN)).rejects.toThrow(/not verified/);
    expect(subs.unverifiedLines(lr).map((l) => l.lineId)).not.toContain("S:EMPIRICAL_GUIDANCE");
    await expect(subs.bulkSetLineStatus(sub.id, lr._rev, ["nope"], "VERIFIED", ADMIN)).rejects.toThrow(/no longer exist/);
    const bulk = await subs.bulkSetLineStatus(sub.id, lr._rev, lr.submittedScore!.lines.map((l) => l.lineId), "VERIFIED", ADMIN);
    expect(subs.unverifiedLines(bulk)).toHaveLength(0);
    // Bulk verification keeps the existing line override and note.
    expect(bulk.lineReviews["S:EMPIRICAL_GUIDANCE"]).toMatchObject({ approvedPoints: "0", note: "No evidence of groups" });
    expect(bulk.approvedPoints).toEqual({ R: "30", T: "100", S: "10" });

    const approved = await subs.approve(bulk.id, bulk._rev, "Reviewed", ADMIN);
    expect(approved.status).toBe("APPROVED");
    expect(approved.locked).toBe(true);
    await expect(subs.adjustApprovedCategory(sub.id, approved._rev, "R", "1", "after lock", ADMIN)).rejects.toThrow(/Not allowed/);
    expect((await exp.exportsFor(sub.id)).map((e) => e.kind).sort()).toEqual(["FINAL", "INITIAL"]);
    expect((await email.attemptsFor(sub.id)).map((a) => a.purpose)).toContain("FINAL_EXPORT");

    // Audit trail covers the consequential changes.
    const events = await db().list<{ id: string; _rev: number; action: string; entityId: string; reason: string }>(C.audit, (e) => e.entityId === sub.id);
    const actions = events.map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["SUBMISSION_SUBMITTED", "APPROVED_CATEGORY_ADJUSTED", "LINE_APPROVED_POINTS_CHANGED", "LINE_REVIEWS_BULK_UPDATED", "SUBMISSION_APPROVED"]));
    expect(events.find((e) => e.action === "APPROVED_CATEGORY_ADJUSTED")?.reason).toBe("Case repository not verified");
    // Versions retained.
    expect((await subs.versionsOf(sub.id)).map((v) => v.kind)).toEqual(["SUBMITTED", "APPROVED_SNAPSHOT"]);

    // Reopen requires a reason and unlocks.
    const reopened = await subs.reopen(sub.id, approved._rev, "Amendment requested by Dean", ADMIN);
    expect(reopened.locked).toBe(false);
  });

  it("clarification round-trip creates a new version and preserves the old one", async () => {
    const { subs } = await mods();
    const { faculty } = await newFaculty("clarify@example.edu");
    const actor = { role: "FACULTY" as const, ref: faculty.id };
    const d = await subs.startSubmission(faculty, "AY2025-26", actor);
    const s1 = await subs.submit(faculty, d.id, d._rev, sampleContent(), { declarationAccepted: true }, actor);
    const c = await subs.requestClarification(s1.id, s1._rev, "Please attach grant sanction letter reference", ADMIN);
    expect(c.status).toBe("NEEDS_CLARIFICATION");
    const content = sampleContent();
    content.research[1]!.values.reference = "DST/2025/123";
    const s2 = await subs.submit(faculty, c.id, c._rev, content, { declarationAccepted: true, responseMessage: "Added reference" }, actor);
    expect(s2.currentVersion).toBe(2);
    expect(s2.messages.map((m) => m.kind)).toEqual(["CLARIFICATION_REQUEST", "FACULTY_RESPONSE"]);
    expect((await subs.versionsOf(s2.id)).map((v) => v.kind)).toEqual(["SUBMITTED", "RESUBMITTED"]);
  });

  it("a faculty member cannot read another faculty member's submission", async () => {
    const { subs } = await mods();
    const a = await newFaculty("own.a@example.edu");
    const b = await newFaculty("own.b@example.edu");
    const d = await subs.startSubmission(a.faculty, "AY2025-26", { role: "FACULTY", ref: a.faculty.id });
    await expect(subs.ownSubmission(b.faculty.id, d.id)).rejects.toThrow(/not found/);
    await expect(subs.saveDraft(b.faculty, d.id, d._rev, sampleContent(), { role: "FACULTY", ref: b.faculty.id })).rejects.toThrow(/not found/);
  });
});

describe("email outcomes", () => {
  async function submitted(emailAddr: string) {
    const { subs } = await mods();
    const { faculty } = await newFaculty(emailAddr);
    const actor = { role: "FACULTY" as const, ref: faculty.id };
    const d = await subs.startSubmission(faculty, "AY2025-26", actor);
    return { faculty, sub: await subs.submit(faculty, d.id, d._rev, sampleContent(), { declarationAccepted: true }, actor) };
  }

  it("permanent failure is not retried; transient failure is retried a bounded number of times", async () => {
    const { email } = await mods();
    const perm = await submitted("nobody@bad.invalid");
    expect((await email.attemptsFor(perm.sub.id)).map((a) => [a.status, a.errorCode])).toEqual([["FAILED", "INVALID_RECIPIENT"]]);
    const temp = await submitted("flaky@retry.test");
    const t = await email.attemptsFor(temp.sub.id);
    expect(t.map((a) => a.status)).toEqual(["FAILED", "FAILED", "FAILED"]);
    expect(t.map((a) => a.attemptNumber)).toEqual([1, 2, 3]);
  });

  it("delivered, bounced and faculty-confirmed receipt are distinct facts; webhooks are verified and idempotent", async () => {
    const { email, db, C } = await mods();
    const { faculty, sub } = await submitted("hooks@example.edu");
    const [a] = await email.attemptsFor(sub.id);
    const body = JSON.stringify({ providerMessageId: a!.providerMessageId, event: "delivered", eventId: "evt1" });
    const sig = crypto.createHmac("sha256", "whsec_test").update(body).digest("hex");
    expect(email.verifyWebhookSignature(body, sig)).toBe(true);
    expect(email.verifyWebhookSignature(body, "00" + sig.slice(2))).toBe(false);
    expect(await email.applyProviderEvent({ providerMessageId: a!.providerMessageId!, event: "delivered", eventId: "evt1" })).toBe("applied");
    expect(await email.applyProviderEvent({ providerMessageId: a!.providerMessageId!, event: "delivered", eventId: "evt1" })).toBe("duplicate");
    const after = await db().require<{ id: string; _rev: number; status: string; deliveredAt: string | null }>(C.emailAttempts, a!.id);
    expect(after.status).toBe("DELIVERED");
    // Receipt confirmation is recorded separately and does not alter the attempt status.
    const r = await email.confirmReceipt(faculty, sub.id, "YES_RECEIVED", { role: "FACULTY", ref: faculty.id });
    expect(r.response).toBe("YES_RECEIVED");
    expect(r.addressShown).toBe("hooks@example.edu");
    expect((await db().require<{ id: string; _rev: number; status: string }>(C.emailAttempts, a!.id)).status).toBe("DELIVERED");
    // Bounce.
    await email.applyProviderEvent({ providerMessageId: a!.providerMessageId!, event: "bounced", eventId: "evt2", detail: "mailbox full" });
    expect((await db().require<{ id: string; _rev: number; status: string }>(C.emailAttempts, a!.id)).status).toBe("BOUNCED");
  });

  it("not received + wrong address → Admin-approved correction → resend to new address", async () => {
    const { email, db, C } = await mods();
    const { faculty, sub } = await submitted("typo@exmaple.edu");
    const actor = { role: "FACULTY" as const, ref: faculty.id };
    const r = await email.confirmReceipt(faculty, sub.id, "NO_NOT_RECEIVED", actor);
    expect(r.followUp).toBe("PENDING_ANSWER");
    const { correction } = await email.answerNotReceived(faculty, r.id, { addressCorrect: false, requestedEmail: "typo@Example.EDU", explanation: "domain typo" }, actor);
    expect(correction?.requestedEmail).toBe("typo@example.edu");
    // Master record unchanged until Admin approves.
    expect((await db().require<{ id: string; _rev: number; email: string }>(C.faculty, faculty.id)).email).toBe("typo@exmaple.edu");
    await email.decideCorrection(correction!.id, true, "Faculty confirmed directly by phone", ADMIN);
    expect((await db().require<{ id: string; _rev: number; email: string }>(C.faculty, faculty.id)).email).toBe("typo@example.edu");
    const resend = await email.resendLatestExport(sub.id, ADMIN);
    expect(resend.recipientEmail).toBe("typo@example.edu");
    expect(resend.purpose).toBe("RESEND_EXPORT");
    const all = await email.attemptsFor(sub.id);
    expect(all.length).toBe(2);
    const audit = await db().list<{ id: string; _rev: number; action: string; entityId: string }>(C.audit, (e) => e.entityId === faculty.id && e.action === "FACULTY_EMAIL_CORRECTED");
    expect(audit.length).toBe(1);
  });

  it("not received + address correct → unresolved Admin issue", async () => {
    const { email } = await mods();
    const { faculty, sub } = await submitted("correct@example.edu");
    const actor = { role: "FACULTY" as const, ref: faculty.id };
    const r = await email.confirmReceipt(faculty, sub.id, "NO_NOT_RECEIVED", actor);
    const { receipt } = await email.answerNotReceived(faculty, r.id, { addressCorrect: true, notes: "checked spam" }, actor);
    expect(receipt.followUp).toBe("ADDRESS_CORRECT_NOT_RECEIVED");
    expect(receipt.resolved).toBe(false);
    const done = await email.resolveReceiptIssue(r.id, "Resent manually", ADMIN);
    expect(done.resolved).toBe(true);
  });
});

describe("payments and consolidation", () => {
  it("consolidated rows derive from submissions; payment history is kept per year", async () => {
    const { pay, fac } = await mods();
    const c = await pay.consolidated("AY2025-26", "STANDARD");
    const row = c.rows.find((r) => r.faculty.email === "life@example.edu");
    expect(row?.points).toEqual({ R: "30", T: "100", S: "10" });
    const f = (await fac.listFaculty()).find((x) => x.email === "life@example.edu")!;
    await expect(pay.savePayment(f.id, "AY2025-26", null, { paidAmount: "1000", correctedAmount: "1500", fpmCount: "", fpmRate: "", paymentReference: "", notes: "", imported: false }, "", ADMIN)).rejects.toThrow(/reason/);
    const p = await pay.savePayment(f.id, "AY2025-26", null, { paidAmount: "1000", correctedAmount: "1500", fpmCount: "", fpmRate: "", paymentReference: "NEFT1", notes: "", imported: false }, "Finance sheet", ADMIN);
    const c2 = await pay.consolidated("AY2025-26", "STANDARD");
    expect(c2.rows.find((r) => r.faculty.id === f.id)?.differential).toBe("500");
    const csv = pay.consolidatedCsv(c2);
    expect(csv).toContain("Nil");
    expect(p._rev).toBe(1);
  });
});

describe("backup and restore", () => {
  it("a backup can be restored into a fresh directory with all records valid", async () => {
    const { db, C, maint, createStore } = await mods();
    const bdir = await fs.mkdtemp(path.join(os.tmpdir(), "rts-bk-"));
    const out = await maint.backup(db(), bdir);
    const target = path.join(bdir, "restored");
    await maint.restore(out, target);
    const restored = createStore(target);
    expect((await restored.list(C.submissions)).length).toBe((await db().list(C.submissions)).length);
    expect((await restored.list(C.audit)).length).toBeGreaterThan(0);
    await fs.rm(bdir, { recursive: true, force: true });
  });
});

describe("Admin policy editor", () => {
  it("creates an audited new version, assigns it to a year with only drafts, and keeps versions immutable", async () => {
    const { db, C, subs } = await mods();
    const years = await import("@/server/services/academicYears");
    const policies = await import("@/server/services/policies");
    const { editableParameters } = await import("@/lib/policyParams");
    const { getPolicy } = await import("@/server/policy/load");

    // The seeded year uses the newest installed policy.
    const ay25 = await db().require<AcademicYear>(C.academicYears, "AY2025-26");
    expect(ay25.policyVersion).toBe("2025-26.v2");

    // Next year, open now, starts on v2; a faculty member opens a draft.
    await years.saveYear({ id: "AY2026-27", label: "AY 2026-27", startDate: "2026-04-01", endDate: "2027-03-31", submissionOpenAt: "2020-01-01", submissionCloseAt: "2099-12-31", status: "OPEN", policyVersion: "2025-26.v2", historicalOnly: false }, null, "", ADMIN);
    const { faculty } = await newFaculty("policy-next@example.edu");
    const draft = await subs.startSubmission(faculty, "AY2026-27", { role: "FACULTY", ref: faculty.id });
    expect(draft.policyVersion).toBe("2025-26.v2");

    // Admin raises Area Chair to 12 and the research rate to 7,500 for next year.
    const params = editableParameters(await getPolicy("2025-26.v2"));
    const id = (pred: (l: string) => boolean) => params.find((p) => pred(p.label))!.id;
    const input = {
      baseVersion: "2025-26.v2",
      newVersion: "2026-27.v1",
      label: "AY 2026-27 values",
      effectiveFrom: "2026-04-01",
      edits: { [id((l) => l.startsWith("Area Chair — points"))]: "12", [id((l) => l.startsWith("Research rate"))]: "7500" },
      assignToYearId: "AY2026-27",
    };
    await expect(policies.createPolicyVersion(input, "", ADMIN)).rejects.toThrow(/reason/i);
    const res = await policies.createPolicyVersion(input, "Approved for next year", ADMIN);
    expect(res.changes).toHaveLength(2);

    const p = await getPolicy("2026-27.v1");
    expect(p.service.roles.find((r) => r.key === "AREA_CHAIR")?.points).toBe("12");
    expect((await getPolicy("2025-26.v2")).service.roles.find((r) => r.key === "AREA_CHAIR")?.points).toBe("10");
    expect((await db().require<AcademicYear>(C.academicYears, "AY2026-27")).policyVersion).toBe("2026-27.v1");
    // The draft follows the year and is scored with the new values.
    expect((await db().require<Submission>(C.submissions, draft.id)).policyVersion).toBe("2026-27.v1");
    const saved = await subs.saveDraft(faculty, draft.id, (await db().require<Submission>(C.submissions, draft.id))._rev, { teaching: [], research: [], service: { roles: { AREA_CHAIR: { quantity: "1", description: "" } }, disclosures: {} }, facultyNotes: "" }, { role: "FACULTY", ref: faculty.id });
    expect(saved.preview.score.totals.S).toBe("12");

    // Audit trail records the value diff.
    const ev = await db().list<AuditEvent>(C.audit, (a) => a.action === "POLICY_VERSION_CREATED" && a.entityId === "2026-27.v1");
    expect((ev[0]?.after as { changes?: unknown[] } | undefined)?.changes).toHaveLength(2);

    // Names are never reused.
    await expect(policies.createPolicyVersion(input, "again", ADMIN)).rejects.toThrow(/already exists/);
  });

  it("edits a never-used version in place, and refuses once it is in use", async () => {
    const { db, C, subs } = await mods();
    const policies = await import("@/server/services/policies");
    const { editableParameters } = await import("@/lib/policyParams");
    const { getPolicy } = await import("@/server/policy/load");
    type PolicyRecord = import("@/server/domain/schemas").PolicyRecord;

    // 2025-26.v2 has submitted/approved records from earlier tests: new version only.
    expect((await policies.policyUsage("2025-26.v2")).inUse).toBe(true);
    // 2026-27.v1 (created above) only has a draft under it.
    expect(await policies.policyUsage("2026-27.v1")).toEqual({ inUse: false, reasons: [] });

    const params = editableParameters(await getPolicy("2026-27.v1"));
    const areaChair = params.find((p) => p.label.startsWith("Area Chair — points"))!.id;
    const rec = await db().require<PolicyRecord>(C.policies, "2026-27.v1");
    const input = { version: "2026-27.v1", expectedRev: rec._rev, label: "AY 2026-27 values (revised)", effectiveFrom: "2026-04-01", edits: { [areaChair]: "14" }, assignToYearId: null };
    await expect(policies.updatePolicyVersionInPlace(input, "", ADMIN)).rejects.toThrow(/reason/i);
    const res = await policies.updatePolicyVersionInPlace(input, "Owner tweak before opening", ADMIN);
    expect(res.changes).toHaveLength(1);
    const p = await getPolicy("2026-27.v1");
    expect(p.service.roles.find((r) => r.key === "AREA_CHAIR")?.points).toBe("14");
    expect(p.label).toBe("AY 2026-27 values (revised)");
    // Stale revisions are rejected.
    await expect(policies.updatePolicyVersionInPlace({ ...input, edits: { [areaChair]: "15" } }, "again", ADMIN)).rejects.toThrow(/changed by someone else/);

    // The previous policy body is kept in the audit log.
    const ev = await db().list<AuditEvent>(C.audit, (a) => a.action === "POLICY_VERSION_EDITED" && a.entityId === "2026-27.v1");
    expect(ev).toHaveLength(1);
    const before = ev[0]?.before as { policy?: { service?: { roles?: { key: string; points: string }[] } } };
    expect(before.policy?.service?.roles?.find((r) => r.key === "AREA_CHAIR")?.points).toBe("12");

    // The draft under this version is re-scored with the edited value, then submitted.
    const draft = (await db().list<Submission>(C.submissions, (s) => s.policyVersion === "2026-27.v1" && s.status === "DRAFT"))[0]!;
    const faculty = await db().require<import("@/server/domain/schemas").Faculty>(C.faculty, draft.facultyId);
    const actor = { role: "FACULTY" as const, ref: faculty.id };
    const content = { teaching: [], research: [], service: { roles: { AREA_CHAIR: { quantity: "1", description: "" } }, disclosures: {} }, facultyNotes: "" };
    const saved = await subs.saveDraft(faculty, draft.id, draft._rev, content, actor);
    expect(saved.preview.score.totals.S).toBe("14");
    await subs.submit(faculty, draft.id, (await db().require<Submission>(C.submissions, draft.id))._rev, content, { declarationAccepted: true }, actor);

    // Now in use: in-place edits are refused and nothing changes.
    const usage = await policies.policyUsage("2026-27.v1");
    expect(usage.inUse).toBe(true);
    const rec2 = await db().require<PolicyRecord>(C.policies, "2026-27.v1");
    await expect(policies.updatePolicyVersionInPlace({ ...input, expectedRev: rec2._rev, edits: { [areaChair]: "20" } }, "late change", ADMIN)).rejects.toThrow(/already in use/);
    expect((await getPolicy("2026-27.v1")).service.roles.find((r) => r.key === "AREA_CHAIR")?.points).toBe("14");
  });
});

describe("mid-year policy change", () => {
  it("allows switching at any time; submitted records wait for an explicit recompute, drafts follow, rejected stay locked", async () => {
    const { db, C, subs, pay, email, exp } = await mods();
    const years = await import("@/server/services/academicYears");
    const recompute = await import("@/server/services/recompute");
    const policies = await import("@/server/services/policies");
    const Y = "AY2027-28";
    await years.saveYear({ id: Y, label: "AY 2027-28", startDate: "2027-04-01", endDate: "2028-03-31", submissionOpenAt: "2020-01-01", submissionCloseAt: "2099-12-31", status: "OPEN", policyVersion: "2025-26.v1", historicalOnly: false }, null, "", ADMIN);
    const content = { teaching: [], research: [], service: { roles: { AREA_CHAIR: { quantity: "1", description: "" } }, disclosures: {} }, facultyNotes: "" };
    const submitAs = async (email: string) => {
      const { faculty } = await newFaculty(email);
      const actor = { role: "FACULTY" as const, ref: faculty.id };
      const d = await subs.startSubmission(faculty, Y, actor);
      return { faculty, actor, sub: await subs.submit(faculty, d.id, d._rev, content, { declarationAccepted: true }, actor) };
    };
    const a = await submitAs("midyear.a@example.edu");
    const b = await submitAs("midyear.b@example.edu");
    expect(a.sub.submittedPoints?.S).toBe("7"); // v1 Area Chair
    const { faculty: c } = await newFaculty("midyear.c@example.edu");
    const cActor = { role: "FACULTY" as const, ref: c.id };
    const cDraft = await subs.startSubmission(c, Y, cActor);
    await subs.saveDraft(c, cDraft.id, cDraft._rev, content, cActor);
    // b is rejected before the change and must stay as it was.
    await subs.reject(b.sub.id, b.sub._rev, "Superseded by revised policy", ADMIN);

    const ay0 = await db().require<AcademicYear>(C.academicYears, Y);
    const { _rev, createdAt, updatedAt, ...yearInput } = ay0;
    void createdAt;
    void updatedAt;
    // Submitted records no longer block the switch.
    expect((await years.saveYear({ ...yearInput, policyVersion: "2025-26.v2" }, _rev, "Owner revision adopted mid-year", ADMIN)).policyVersion).toBe("2025-26.v2");

    // Submitted record keeps v1 until recomputed; the draft follows; the rejected record is untouched.
    expect((await db().require<Submission>(C.submissions, a.sub.id)).policyVersion).toBe("2025-26.v1");
    expect((await db().require<Submission>(C.submissions, cDraft.id)).policyVersion).toBe("2025-26.v2");
    const bOld = await db().require<Submission>(C.submissions, b.sub.id);
    expect([bOld.status, bOld.policyVersion, bOld.locked]).toEqual(["REJECTED", "2025-26.v1", true]);

    // The change is detected, with a preview of old vs new points.
    const summary = (await recompute.policyChangeSummaries()).find((x) => x.year.id === Y)!;
    expect(summary.candidates.map((x) => [x.submission.id, x.oldPoints.S, x.newPoints.S])).toEqual([[a.sub.id, "7", "10"]]);
    expect(summary.drafts.map((d) => [d.submission.id, d.oldPoints?.S, d.newPoints.S, d.notified])).toEqual([[cDraft.id, "7", "10", false]]);

    // A stale record cannot be approved, even when every line is verified.
    const aVer = await subs.bulkSetLineStatus(a.sub.id, a.sub._rev, a.sub.submittedScore!.lines.map((l) => l.lineId), "VERIFIED", ADMIN);
    await expect(subs.approve(a.sub.id, aVer._rev, "", ADMIN)).rejects.toThrow(/Recompute/);

    // Recompute (reason required) + notify the draft holder.
    await expect(recompute.runPolicyChange({ submissionIds: [a.sub.id], draftIds: [], reason: "" }, ADMIN)).rejects.toThrow(/reason/i);
    const run = await recompute.runPolicyChange({ submissionIds: [a.sub.id, b.sub.id], draftIds: [cDraft.id], reason: "Nov 2026 revision" }, ADMIN);
    expect(run.recomputed).toBe(1);
    expect(run.notified).toBe(1);
    expect(run.failures).toHaveLength(1); // the rejected record is refused
    const aNew = await db().require<Submission>(C.submissions, a.sub.id);
    expect([aNew.policyVersion, aNew.submittedPoints?.S, aNew.approvedPoints?.S, aNew.currentVersion, aNew.locked]).toEqual(["2025-26.v2", "10", "10", 2, false]);
    // The line's points changed, so its earlier verification is cleared.
    expect(subs.unverifiedLines(aNew).map((l) => l.lineId)).toEqual(["S:AREA_CHAIR"]);
    expect((await subs.versionsOf(a.sub.id)).map((v) => [v.kind, v.score.policyVersion])).toEqual([["SUBMITTED", "2025-26.v1"], ["POLICY_RECOMPUTED", "2025-26.v2"]]);
    expect((await exp.exportsFor(a.sub.id)).map((e) => e.kind)).toContain("RECOMPUTED");
    const mails = await email.attemptsFor(a.sub.id);
    expect(mails.find((m) => m.purpose === "POLICY_RECOMPUTED")?.status).toBe("SEND_ACCEPTED");
    expect((await email.attemptsFor(cDraft.id)).map((m) => m.purpose)).toEqual(["POLICY_DRAFT_NOTICE"]);
    const ev = await db().list<AuditEvent>(C.audit, (e) => e.action === "SUBMISSION_RECOMPUTED" && e.entityId === a.sub.id);
    expect(ev[0]?.reason).toBe("Nov 2026 revision");
    // Nothing pending any more for this year.
    expect((await recompute.policyChangeSummaries()).find((x) => x.year.id === Y)).toBeUndefined();
    // v1 is still "in use" (history + the rejected record) and stays immutable.
    expect((await policies.policyUsage("2025-26.v1")).inUse).toBe(true);

    // Admin verifies and approves the recomputed record.
    const v2 = await subs.bulkSetLineStatus(a.sub.id, aNew._rev, ["S:AREA_CHAIR"], "VERIFIED", ADMIN);
    expect((await subs.approve(a.sub.id, v2._rev, "Recomputed", ADMIN)).status).toBe("APPROVED");

    // The rejected faculty member starts a fresh submission under v2; the old one cannot be reopened.
    const fresh = await subs.startSubmission(b.faculty, Y, b.actor);
    expect(fresh.id).not.toBe(b.sub.id);
    expect([fresh.status, fresh.policyVersion]).toEqual(["DRAFT", "2025-26.v2"]);
    expect((await subs.startSubmission(b.faculty, Y, b.actor)).id).toBe(fresh.id);
    expect(subs.currentSubmission(await subs.facultySubmissions(b.faculty.id))?.id).toBe(fresh.id);
    expect(await db().list<AuditEvent>(C.audit, (e) => e.action === "SUBMISSION_RESTARTED_AFTER_REJECTION" && e.entityId === fresh.id)).toHaveLength(1);
    await expect(subs.reopen(b.sub.id, bOld._rev, "try reopen", ADMIN)).rejects.toThrow(/already started a new submission/);

    // Consolidated sheet ignores rejected records' points.
    const row = (await pay.consolidated(Y, "STANDARD")).rows.find((r) => r.faculty.id === b.faculty.id);
    expect(row?.points).toBeNull();
  });

  it("recomputing an approved record reopens it; the approved snapshot stays in history", async () => {
    const { db, C, subs } = await mods();
    const years = await import("@/server/services/academicYears");
    const recompute = await import("@/server/services/recompute");
    const Y = "AY2028-29";
    await years.saveYear({ id: Y, label: "AY 2028-29", startDate: "2028-04-01", endDate: "2029-03-31", submissionOpenAt: "2020-01-01", submissionCloseAt: "2099-12-31", status: "OPEN", policyVersion: "2025-26.v1", historicalOnly: false }, null, "", ADMIN);
    const { faculty } = await newFaculty("recompute.approved@example.edu");
    const actor = { role: "FACULTY" as const, ref: faculty.id };
    const d = await subs.startSubmission(faculty, Y, actor);
    const content = { teaching: [], research: [], service: { roles: { AREA_CHAIR: { quantity: "1", description: "" }, ADMISSIONS: { quantity: "1", description: "" } }, disclosures: {} }, facultyNotes: "" };
    const s = await subs.submit(faculty, d.id, d._rev, content, { declarationAccepted: true }, actor);
    const v = await subs.bulkSetLineStatus(s.id, s._rev, s.submittedScore!.lines.map((l) => l.lineId), "VERIFIED", ADMIN);
    const ap = await subs.approve(s.id, v._rev, "", ADMIN);
    expect(ap.status).toBe("APPROVED");

    const ay = await db().require<AcademicYear>(C.academicYears, Y);
    const { _rev, createdAt, updatedAt, ...yearInput } = ay;
    void createdAt;
    void updatedAt;
    await years.saveYear({ ...yearInput, policyVersion: "2025-26.v2" }, _rev, "revision", ADMIN);
    // The approved record is untouched until recomputed.
    expect((await db().require<Submission>(C.submissions, s.id)).status).toBe("APPROVED");

    const r = await recompute.recomputeSubmission(s.id, "Apply revision", ADMIN);
    expect([r.status, r.locked, r.approvedAt]).toEqual(["UNDER_REVIEW", false, null]);
    // Admissions is 20 in both versions: its verification is kept; Area Chair changed: cleared.
    expect(r.lineReviews["S:ADMISSIONS"]?.status).toBe("VERIFIED");
    expect(r.lineReviews["S:AREA_CHAIR"]).toBeUndefined();
    expect((await subs.versionsOf(s.id)).map((x) => x.kind)).toEqual(["SUBMITTED", "APPROVED_SNAPSHOT", "POLICY_RECOMPUTED"]);
    await expect(recompute.recomputeSubmission(s.id, "again", ADMIN)).rejects.toThrow(/already uses/);
  });
});

describe("faculty category", () => {
  it("is always derived from the designation (Junior Faculty and Librarian are Junior)", async () => {
    const { fac } = await mods();
    const base = { email: "", designationKey: "", dateOfJoining: "2020-01-01", researchStatus: "RESEARCH_ACTIVE", employeeId: "", dateOfExit: "", active: true };
    const make = (email: string, designationKey: string) => fac.createFaculty({ ...base, displayName: `Cat ${email}`, email, designationKey }, ADMIN);
    expect((await make("cat.prof@example.edu", "PROFESSOR")).facultyCategory).toBe("STANDARD");
    expect((await make("cat.jf@example.edu", "JUNIOR_FACULTY")).facultyCategory).toBe("JUNIOR");
    const lib = await make("cat.lib@example.edu", "LIBRARIAN");
    expect(lib.facultyCategory).toBe("JUNIOR");
    // Changing the designation changes the category; any category sent by a client is ignored.
    const moved = await fac.updateFaculty(lib.id, lib._rev, { ...base, displayName: lib.displayName, email: lib.email, designationKey: "ASSISTANT_PROFESSOR", facultyCategory: "JUNIOR" } as Parameters<typeof fac.updateFaculty>[2], "Promoted", ADMIN);
    expect(moved.facultyCategory).toBe("STANDARD");
  });
});

describe("access codes by email", () => {
  it("emails a new or regenerated code to the master address without storing it", async () => {
    const { db, C, fac } = await mods();
    const { faculty, code } = await newFaculty("code.mail@example.edu");
    const attempts = await db().list<import("@/server/domain/schemas").EmailAttempt>(C.emailAttempts, (a) => a.facultyId === faculty.id && a.purpose === "ACCESS_CODE");
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ recipientEmail: "code.mail@example.edu", status: "SEND_ACCEPTED", submissionId: null });
    expect(JSON.stringify(attempts[0])).not.toContain(code);
    // The message itself (outbox in development) carries the code.
    const outbox = path.join(dir, "outbox");
    const files = await fs.readdir(outbox);
    const bodies = await Promise.all(files.map((f) => fs.readFile(path.join(outbox, f), "utf8")));
    expect(bodies.some((b) => b.includes(code))).toBe(true);

    // Regeneration sends a fresh email (new generation, new idempotency key).
    const regen = await fac.issueAccessCode(faculty.id, ADMIN);
    expect(regen.email?.status).toBe("SEND_ACCEPTED");
    expect(await db().list<import("@/server/domain/schemas").EmailAttempt>(C.emailAttempts, (a) => a.facultyId === faculty.id && a.purpose === "ACCESS_CODE")).toHaveLength(2);
  });
});

describe("sessions", () => {
  it("extends a session once less than half of its lifetime remains", async () => {
    const { db, C, auth } = await mods();
    const res = await auth.loginAdmin("admin", "correct horse battery", "9.9.9.9");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(await auth.extendSessionIfDue(res.session)).toBeNull();
    const ttl = 120 * 60_000;
    const late = Date.parse(res.session.expiresAt) - ttl / 4;
    const renewed = await auth.extendSessionIfDue(res.session, late);
    expect(Date.parse(renewed!.expiresAt)).toBe(late + ttl);
    expect((await db().require<{ id: string; _rev: number; expiresAt: string }>(C.sessions, res.session.id)).expiresAt).toBe(renewed!.expiresAt);
  });
});
