"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminAction } from "@/server/auth/session";
import { run, type ActionResult } from "@/server/services/common";
import * as subs from "@/server/services/submissions";
import * as fac from "@/server/services/faculty";
import * as years from "@/server/services/academicYears";
import * as pay from "@/server/services/payments";
import * as email from "@/server/services/email";
import * as policies from "@/server/services/policies";
import { generateExport } from "@/server/services/exports";
import * as recompute from "@/server/services/recompute";

/** Admin server actions. Every one re-checks the Admin session on the server. */

const id = z.string().regex(/^[A-Za-z0-9_.-]{1,120}$/);
const rev = z.number().int().positive();
const text = z.string().max(4000);

function touch(...paths: string[]) {
  for (const p of paths) revalidatePath(p);
}

export async function reviewAction(
  op: "start" | "clarify" | "approve" | "reject" | "reopen" | "note",
  submissionId: string,
  revision: number,
  message: string,
): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    const sid = id.parse(submissionId);
    const r = rev.parse(revision);
    const m = text.parse(message ?? "");
    if (op === "start") await subs.startReview(sid, r, actor);
    else if (op === "clarify") await subs.requestClarification(sid, r, m, actor);
    else if (op === "approve") await subs.approve(sid, r, m, actor);
    else if (op === "reject") await subs.reject(sid, r, m, actor);
    else if (op === "reopen") await subs.reopen(sid, r, m, actor);
    else await subs.addAdminNote(sid, r, m, actor);
    touch(`/admin/submissions/${sid}`, "/admin");
    return undefined;
  });
}

export async function adjustCategoryAction(submissionId: string, revision: number, category: "R" | "T" | "S", value: string, reason: string): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    await subs.adjustApprovedCategory(id.parse(submissionId), rev.parse(revision), z.enum(["R", "T", "S"]).parse(category), String(value), text.parse(reason ?? ""), actor);
    touch(`/admin/submissions/${submissionId}`);
    return undefined;
  }, "Approved points updated");
}

export async function lineReviewAction(submissionId: string, revision: number, lineId: string, input: { status: string; note: string; approvedPoints: string | null; reason: string }): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    const v = z.object({ status: z.enum(["UNVERIFIED", "VERIFIED", "DISPUTED", "NEEDS_EVIDENCE"]), note: text, approvedPoints: z.string().max(30).nullable(), reason: text }).parse(input);
    await subs.setLineReview(id.parse(submissionId), rev.parse(revision), z.string().max(200).parse(lineId), v, actor);
    touch(`/admin/submissions/${submissionId}`);
    return undefined;
  }, "Line review saved");
}

export async function bulkLineStatusAction(submissionId: string, revision: number, lineIds: string[], status: "VERIFIED" | "UNVERIFIED"): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    const ids = z.array(z.string().max(200)).max(1000).parse(lineIds);
    const st = z.enum(["VERIFIED", "UNVERIFIED"]).parse(status);
    await subs.bulkSetLineStatus(id.parse(submissionId), rev.parse(revision), ids, st, actor);
    touch(`/admin/submissions/${submissionId}`);
    return undefined;
  }, status === "VERIFIED" ? "Selected lines marked verified" : "Selected lines marked unverified");
}

export async function exportAndEmailAction(submissionId: string, op: "regenerate" | "resend"): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    const sid = id.parse(submissionId);
    if (op === "regenerate") await generateExport(sid, "REGENERATED", actor);
    await email.resendLatestExport(sid, actor);
    touch(`/admin/submissions/${sid}`, "/admin/email-issues");
    return undefined;
  }, "Email sent to the provider");
}

// ---------------------------------------------------------------- Faculty master
const facultyForm = z.object({
  displayName: z.string(),
  email: z.string(),
  designationKey: z.string(),
  facultyCategory: z.enum(["STANDARD", "JUNIOR"]),
  dateOfJoining: z.string(),
  researchStatus: z.string(),
  employeeId: z.string(),
  dateOfExit: z.string(),
  active: z.boolean(),
});

export async function saveFacultyAction(facultyId: string | null, revision: number | null, input: unknown, reason: string): Promise<ActionResult<{ id: string }>> {
  return run(async () => {
    const { actor } = await adminAction();
    const v = facultyForm.parse(input);
    const f = facultyId ? await fac.updateFaculty(id.parse(facultyId), rev.parse(revision), v, text.parse(reason ?? ""), actor) : await fac.createFaculty(v, actor);
    touch("/admin/faculty");
    return { id: f.id };
  }, "Faculty record saved");
}

/**
 * Issues/regenerates a code and emails it to the faculty member. The raw code is returned to the
 * browser only when the email could not be handed to the provider, so the Admin can deliver it another way.
 */
export async function issueCodeAction(facultyId: string): Promise<ActionResult<{ name: string; email: string; emailed: boolean; emailError: string | null; code: string | null }>> {
  return run(async () => {
    const { actor } = await adminAction();
    const r = await fac.issueAccessCode(id.parse(facultyId), actor);
    touch("/admin/faculty");
    const emailed = r.email !== null && r.email.status !== "FAILED";
    return {
      name: r.faculty.displayName,
      email: r.faculty.email,
      emailed,
      emailError: emailed ? null : (r.email?.errorMessage ?? "The email could not be sent."),
      code: emailed ? null : r.code,
    };
  });
}

export async function revokeCodeAction(facultyId: string, reason: string): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    await fac.revokeAccess(id.parse(facultyId), text.parse(reason ?? ""), actor);
    touch("/admin/faculty");
    return undefined;
  }, "Access revoked");
}

// ---------------------------------------------------------------- Academic years
export async function saveYearAction(input: unknown, revision: number | null, reason: string): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    await years.saveYear(years.academicYearInput.parse(input), revision === null ? null : rev.parse(revision), text.parse(reason ?? ""), actor);
    touch("/admin/academic-years");
    return undefined;
  }, "Academic year saved");
}

// ---------------------------------------------------------------- Policy versions
export async function createPolicyVersionAction(input: unknown, reason: string): Promise<ActionResult<{ version: string; changes: number }>> {
  return run(async () => {
    const { actor } = await adminAction();
    const r = await policies.createPolicyVersion(policies.policyEditInput.parse(input), text.parse(reason ?? ""), actor);
    touch("/admin/policy", "/admin/academic-years");
    return { version: r.version, changes: r.changes.length };
  }, "Policy version created");
}

export async function updatePolicyVersionAction(input: unknown, reason: string): Promise<ActionResult<{ version: string; changes: number }>> {
  return run(async () => {
    const { actor } = await adminAction();
    const r = await policies.updatePolicyVersionInPlace(policies.policyInPlaceEditInput.parse(input), text.parse(reason ?? ""), actor);
    touch("/admin/policy", "/admin/academic-years");
    return { version: r.version, changes: r.changes.length };
  }, "Policy version updated");
}

export async function runPolicyChangeAction(submissionIds: string[], draftIds: string[], reason: string): Promise<ActionResult<{ recomputed: number; notified: number; failures: string[] }>> {
  return run(async () => {
    const { actor } = await adminAction();
    const ids = z.array(id).max(2000);
    const r = await recompute.runPolicyChange({ submissionIds: ids.parse(submissionIds), draftIds: ids.parse(draftIds), reason: text.parse(reason ?? "") }, actor);
    touch("/admin/policy-changes", "/admin", "/admin/submissions");
    return r;
  });
}

export async function recomputeOneAction(submissionId: string, reason: string): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    await recompute.recomputeSubmission(id.parse(submissionId), text.parse(reason ?? ""), actor);
    touch(`/admin/submissions/${submissionId}`, "/admin/policy-changes");
    return undefined;
  }, "Recomputed under the current policy; the faculty member has been emailed");
}

// ---------------------------------------------------------------- Payments
const paymentForm = z.object({ paidAmount: z.string(), correctedAmount: z.string(), fpmCount: z.string(), fpmRate: z.string(), paymentReference: z.string(), notes: z.string(), imported: z.boolean() });
export async function savePaymentAction(facultyId: string, academicYearId: string, revision: number | null, input: unknown, reason: string): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    await pay.savePayment(id.parse(facultyId), id.parse(academicYearId), revision === null ? null : rev.parse(revision), paymentForm.parse(input), text.parse(reason ?? ""), actor);
    touch("/admin/payments");
    return undefined;
  }, "Payment saved");
}

// ---------------------------------------------------------------- Email issues
export async function decideCorrectionAction(correctionId: string, approve: boolean, reason: string): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    await email.decideCorrection(id.parse(correctionId), approve === true, text.parse(reason ?? ""), actor);
    touch("/admin/email-issues");
    return undefined;
  }, approve ? "Email address updated" : "Request rejected");
}

export async function resolveIssueAction(receiptId: string, note: string): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    await email.resolveReceiptIssue(id.parse(receiptId), text.parse(note ?? ""), actor);
    touch("/admin/email-issues");
    return undefined;
  }, "Issue resolved");
}

export async function resendAction(submissionId: string): Promise<ActionResult> {
  return run(async () => {
    const { actor } = await adminAction();
    await email.resendLatestExport(id.parse(submissionId), actor);
    touch("/admin/email-issues", `/admin/submissions/${submissionId}`);
    return undefined;
  }, "Resent");
}
