import { z } from "zod";
import { C, db } from "../db";
import type { EmailAttempt, Faculty } from "../domain/schemas";
import { newId } from "../store/fileStore";
import { audit, type Actor } from "../audit";
import { generateAccessCode, hashSecret } from "../auth/secrets";
import { currentPolicy } from "./config";
import { sendEmail } from "./email";
import { env } from "../env";
import { UserError, normalizeEmail, nowIso, reasonRequired } from "./common";

export const facultyInput = z.object({
  displayName: z.string().trim().min(2, "Enter the faculty name.").max(200),
  email: z.string().trim().email("Enter a valid email address."),
  designationKey: z.string().min(1, "Choose a designation."),
  facultyCategory: z.enum(["STANDARD", "JUNIOR"]),
  dateOfJoining: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use a valid date.")
    .transform((v) => (v === "" ? null : v)),
  researchStatus: z.string().min(1, "Choose a research status."),
  employeeId: z
    .string()
    .trim()
    .max(50)
    .transform((v) => (v === "" ? null : v)),
  dateOfExit: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Use a valid date.")
    .transform((v) => (v === "" ? null : v)),
  active: z.boolean(),
});
export type FacultyInput = z.input<typeof facultyInput>;

async function checkAgainstPolicy(v: z.output<typeof facultyInput>) {
  const policy = await currentPolicy();
  if (!policy.designations.items.some((d) => d.key === v.designationKey)) {
    throw new UserError("Designation is not configured.", [{ path: "designationKey", message: "Choose a configured designation." }]);
  }
  if (!policy.researchStatuses.some((r) => r.key === v.researchStatus)) {
    throw new UserError("Research status is not configured.", [{ path: "researchStatus", message: "Choose a configured research status." }]);
  }
  if (v.dateOfJoining && Number.isNaN(Date.parse(v.dateOfJoining))) {
    throw new UserError("Date of joining is invalid.", [{ path: "dateOfJoining", message: "Use a valid date." }]);
  }
  if (v.dateOfExit && (Number.isNaN(Date.parse(v.dateOfExit)) || (v.dateOfJoining && v.dateOfExit < v.dateOfJoining))) {
    throw new UserError("Date of exit is invalid.", [{ path: "dateOfExit", message: "Use a valid date on or after the date of joining." }]);
  }
}

export async function listFaculty(): Promise<Faculty[]> {
  return (await db().list<Faculty>(C.faculty)).sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Minimal, email-free list for the faculty sign-in dropdown. */
export async function facultyLoginOptions(): Promise<{ id: string; label: string }[]> {
  const policy = await currentPolicy().catch(() => null);
  return (await listFaculty())
    .filter((f) => f.active && f.access.status === "ACTIVE")
    .map((f) => ({
      id: f.id,
      label: `${f.displayName} — ${policy?.designations.items.find((d) => d.key === f.designationKey)?.label ?? f.designationKey}`,
    }));
}

export async function createFaculty(input: FacultyInput, actor: Actor): Promise<Faculty> {
  const v = facultyInput.parse(input);
  await checkAgainstPolicy(v);
  const email = normalizeEmail(v.email);
  return db().transact(async (tx) => {
    const dup = await tx.list<Faculty>(C.faculty, (f) => f.email.toLowerCase() === email.toLowerCase());
    if (dup.length) throw new UserError("Another faculty record already uses this email address.", [{ path: "email", message: "Email already in use." }]);
    const now = nowIso();
    const rec = await tx.create<Faculty>(C.faculty, {
      id: newId("fac"),
      ...v,
      email,
      access: { status: "PENDING_ISSUE", secretHash: null, issuedAt: null, revokedAt: null, generation: 0 },
      createdAt: now,
      updatedAt: now,
    });
    await audit(tx, actor, { action: "FACULTY_CREATED", entityType: "faculty", entityId: rec.id, after: { ...rec, access: undefined } });
    return rec;
  });
}

export async function updateFaculty(id: string, rev: number, input: FacultyInput, reason: string, actor: Actor): Promise<Faculty> {
  const v = facultyInput.parse(input);
  const why = reasonRequired(reason, "changing a faculty master record");
  await checkAgainstPolicy(v);
  const email = normalizeEmail(v.email);
  return db().transact(async (tx) => {
    const cur = await tx.require<Faculty>(C.faculty, id);
    if (cur._rev !== rev) throw new UserError("This record was changed by someone else. Reload and try again.");
    if (email.toLowerCase() !== cur.email.toLowerCase()) {
      const dup = await tx.list<Faculty>(C.faculty, (f) => f.id !== id && f.email.toLowerCase() === email.toLowerCase());
      if (dup.length) throw new UserError("Another faculty record already uses this email address.", [{ path: "email", message: "Email already in use." }]);
    }
    const next = await tx.update<Faculty>(C.faculty, { ...cur, ...v, email, updatedAt: nowIso() });
    const strip = (f: Faculty) => ({ ...f, access: undefined, _rev: undefined });
    await audit(tx, actor, { action: email !== cur.email ? "FACULTY_UPDATED_EMAIL_CHANGED" : "FACULTY_UPDATED", entityType: "faculty", entityId: id, before: strip(cur), after: strip(next), reason: why });
    return next;
  });
}

/**
 * Issues or regenerates the faculty member's access code and emails it to the Faculty Master
 * address (owner decision 2026-11-25: codes are emailed, not handed out manually). Only the hash
 * is stored; the email attempt record keeps the subject, never the body. The raw code is returned
 * to the caller so the Admin can be shown it once *only if* the email could not be sent.
 */
export async function issueAccessCode(id: string, actor: Actor): Promise<{ code: string; faculty: Faculty; email: EmailAttempt | null }> {
  const code = generateAccessCode();
  const hash = await hashSecret(code.replace(/-/g, ""));
  const faculty = await db().transact(async (tx) => {
    const cur = await tx.require<Faculty>(C.faculty, id);
    if (!cur.active) throw new UserError("Activate the faculty record before issuing an access code.");
    const regenerated = cur.access.secretHash !== null;
    const next = await tx.update<Faculty>(C.faculty, {
      ...cur,
      access: { status: "ACTIVE", secretHash: hash, issuedAt: nowIso(), revokedAt: null, generation: cur.access.generation + 1 },
      updatedAt: nowIso(),
    });
    await audit(tx, actor, {
      action: regenerated ? "ACCESS_CODE_REGENERATED" : "ACCESS_CODE_ISSUED",
      entityType: "faculty",
      entityId: id,
      after: { accessStatus: "ACTIVE", generation: next.access.generation },
      reason: regenerated ? "Previous code invalidated; existing sessions ended." : "",
    });
    return next;
  });
  let email: EmailAttempt | null = null;
  try {
    email = await sendEmail({
      purpose: "ACCESS_CODE",
      to: faculty.email,
      vars: { name: faculty.displayName, code, link: `${env().APP_BASE_URL}/login`, year: "", reference: "", status: "", message: "" },
      submissionId: null,
      facultyId: faculty.id,
      idempotencyBase: `access:${faculty.id}:g${faculty.access.generation}`,
      actor,
    });
  } catch (e) {
    console.error("[access code] email failed", e);
  }
  return { code, faculty, email };
}

export async function revokeAccess(id: string, reason: string, actor: Actor): Promise<Faculty> {
  const why = reasonRequired(reason, "revoking access");
  return db().transact(async (tx) => {
    const cur = await tx.require<Faculty>(C.faculty, id);
    const next = await tx.update<Faculty>(C.faculty, {
      ...cur,
      access: { ...cur.access, status: "REVOKED", secretHash: null, revokedAt: nowIso(), generation: cur.access.generation + 1 },
      updatedAt: nowIso(),
    });
    await audit(tx, actor, { action: "ACCESS_REVOKED", entityType: "faculty", entityId: id, before: { accessStatus: cur.access.status }, after: { accessStatus: "REVOKED" }, reason: why });
    return next;
  });
}
