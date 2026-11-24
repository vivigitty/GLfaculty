import { z } from "zod";
import { C, db } from "../db";
import type { AcademicYear, PolicyRecord } from "../domain/schemas";
import { audit, type Actor } from "../audit";
import { UserError, nowIso, reasonRequired, todayIso } from "./common";
import { assignPolicyToYear } from "./policies";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date.");
export const academicYearInput = z
  .object({
    id: z.string().regex(/^AY\d{4}-\d{2}$/, "Use the form AY2025-26."),
    label: z.string().trim().min(3).max(60),
    startDate: date,
    endDate: date,
    submissionOpenAt: date,
    submissionCloseAt: date,
    status: z.enum(["UPCOMING", "OPEN", "CLOSED"]),
    policyVersion: z.string().min(1),
    historicalOnly: z.boolean(),
  })
  .refine((v) => v.startDate < v.endDate, { path: ["endDate"], message: "End date must be after the start date." })
  .refine((v) => v.submissionOpenAt <= v.submissionCloseAt, { path: ["submissionCloseAt"], message: "Window must close after it opens." });
export type AcademicYearInput = z.input<typeof academicYearInput>;

export async function listYears(): Promise<AcademicYear[]> {
  return (await db().list<AcademicYear>(C.academicYears)).sort((a, b) => b.startDate.localeCompare(a.startDate));
}

export function isAcceptingSubmissions(ay: AcademicYear, today = todayIso()): boolean {
  return !ay.historicalOnly && ay.status === "OPEN" && today >= ay.submissionOpenAt && today <= ay.submissionCloseAt;
}

async function checkPolicy(version: string) {
  const p = await db().get<PolicyRecord>(C.policies, version);
  if (!p) throw new UserError("Unknown policy version.", [{ path: "policyVersion", message: "Choose an installed policy version." }]);
}

export async function saveYear(input: AcademicYearInput, rev: number | null, reason: string, actor: Actor): Promise<AcademicYear> {
  const v = academicYearInput.parse(input);
  await checkPolicy(v.policyVersion);
  return db().transact(async (tx) => {
    const cur = await tx.get<AcademicYear>(C.academicYears, v.id);
    const now = nowIso();
    if (!cur) {
      if (rev !== null) throw new UserError("Academic year not found.");
      const rec = await tx.create<AcademicYear>(C.academicYears, { ...v, createdAt: now, updatedAt: now });
      await audit(tx, actor, { action: "ACADEMIC_YEAR_CREATED", entityType: "academicYear", entityId: v.id, after: rec });
      return rec;
    }
    if (rev === null) throw new UserError(`${v.id} already exists.`, [{ path: "id", message: "Already exists." }]);
    const why = reasonRequired(reason, "changing an academic year");
    if (cur._rev !== rev) throw new UserError("This academic year was changed by someone else. Reload and try again.");
    // Policy changes go through the shared rule: blocked once submitted; drafts follow the year.
    const assigned = cur.policyVersion !== v.policyVersion ? await assignPolicyToYear(tx, v.id, v.policyVersion, actor, why) : cur;
    const next = await tx.update<AcademicYear>(C.academicYears, { ...assigned, ...v, updatedAt: now });
    await audit(tx, actor, { action: "ACADEMIC_YEAR_UPDATED", entityType: "academicYear", entityId: v.id, before: cur, after: next, reason: why });
    return next;
  });
}
