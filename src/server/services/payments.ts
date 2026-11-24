import Decimal from "decimal.js";
import { z } from "zod";
import { C, db } from "../db";
import type { AcademicYear, Faculty, Payment, RTS, Submission } from "../domain/schemas";
import { audit, type Actor } from "../audit";
import { eligibilityAndPayment, totalOf } from "../scoring/engine";
import { getPolicy } from "../policy/load";
import { currentSubmission, snapshotOf } from "./submissions";
import { UserError, nowIso, reasonRequired } from "./common";

export type ConsolidatedRow = {
  serial: number;
  faculty: Faculty;
  designationLabel: string;
  experienceYears: string | null;
  submission: Submission | null;
  pointsSource: "APPROVED" | "UNDER_REVIEW" | "NOT_SUBMITTED";
  points: RTS | null;
  earned: string | null;
  minimum: string | null;
  pointsPayable: string | null;
  designationRate: string | null;
  expectedPayment: string | null;
  payment: Payment | null;
  differential: string | null;
  history: Record<string, string | null>;
};

export type Consolidated = { ay: AcademicYear; category: "STANDARD" | "JUNIOR"; rows: ConsolidatedRow[]; historyYears: AcademicYear[] };

const paymentId = (facultyId: string, ayId: string) => `${facultyId}__${ayId}`;

/** Consolidated Faculty / Junior Faculty sheet derived from submissions and payment records. */
export async function consolidated(ayId: string, category: "STANDARD" | "JUNIOR"): Promise<Consolidated> {
  const ay = await db().require<AcademicYear>(C.academicYears, ayId);
  const policy = await getPolicy(ay.policyVersion);
  const period = { startDate: ay.startDate, endDate: ay.endDate };
  const years = (await db().list<AcademicYear>(C.academicYears)).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const historyYears = years.filter((y) => y.startDate < ay.startDate);
  const faculty = (await db().list<Faculty>(C.faculty, (f) => f.facultyCategory === category)).sort((a, b) => a.displayName.localeCompare(b.displayName));
  const subs = await db().list<Submission>(C.submissions, (s) => s.academicYearId === ayId);
  const payments = await db().list<Payment>(C.payments);
  const payMap = new Map(payments.map((p) => [p.id, p]));

  const rows: ConsolidatedRow[] = [];
  for (const f of faculty) {
    // Rejected records are history; the live record (if any) drives the sheet.
    const sub = currentSubmission(subs.filter((s) => s.facultyId === f.id));
    if (!f.active && !sub) continue;
    const submitted = sub && sub.status !== "DRAFT" && sub.status !== "REJECTED" && sub.approvedPoints;
    const points = submitted ? sub.approvedPoints : null;
    const snap = sub?.facultySnapshot ?? snapshotOf(f);
    const elig = points ? eligibilityAndPayment(points, policy, snap, period) : null;
    const pay = payMap.get(paymentId(f.id, ayId)) ?? null;
    const diff = pay && (pay.correctedAmount !== null || pay.paidAmount !== null) ? new Decimal(pay.correctedAmount ?? 0).sub(pay.paidAmount ?? 0).toFixed() : null;
    const history: Record<string, string | null> = {};
    for (const y of historyYears) {
      const p = payMap.get(paymentId(f.id, y.id));
      history[y.id] = p ? (p.correctedAmount ?? p.paidAmount) : null;
    }
    const exp = f.dateOfJoining ? ((Date.parse(ay.endDate) - Date.parse(f.dateOfJoining)) / 86_400_000 / 365).toFixed(2) : null;
    rows.push({
      serial: rows.length + 1,
      faculty: f,
      designationLabel: policy.designations.items.find((d) => d.key === f.designationKey)?.label ?? f.designationKey,
      experienceYears: exp,
      submission: sub,
      pointsSource: !submitted ? "NOT_SUBMITTED" : sub.status === "APPROVED" ? "APPROVED" : "UNDER_REVIEW",
      points,
      earned: points ? totalOf(points) : null,
      minimum: elig?.minimum ?? null,
      pointsPayable: elig?.pointsPayable ?? null,
      designationRate: policy.designations.items.find((d) => d.key === f.designationKey)?.pointRate ?? null,
      expectedPayment: elig?.payment ?? null,
      payment: pay,
      differential: diff,
      history,
    });
  }
  return { ay, category, rows, historyYears };
}

const money = z
  .string()
  .trim()
  .regex(/^(\d+(\.\d{1,2})?)?$/, "Enter an amount in rupees (up to 2 decimals).")
  .transform((v) => (v === "" ? null : v));

export const paymentInput = z.object({
  paidAmount: money,
  correctedAmount: money,
  fpmCount: z.string().trim().regex(/^(\d+)?$/, "Whole number").transform((v) => (v === "" ? null : v)),
  fpmRate: money,
  paymentReference: z.string().trim().max(200),
  notes: z.string().trim().max(2000),
  imported: z.boolean(),
});
export type PaymentInput = z.input<typeof paymentInput>;

/** Finance-entered amounts. Each (faculty, year) is its own record; other years are never touched. */
export async function savePayment(facultyId: string, ayId: string, rev: number | null, input: PaymentInput, reason: string, actor: Actor): Promise<Payment> {
  const v = paymentInput.parse(input);
  const why = reasonRequired(reason, "a payment change");
  return db().transact(async (tx) => {
    await tx.require<Faculty>(C.faculty, facultyId);
    await tx.require<AcademicYear>(C.academicYears, ayId);
    const id = paymentId(facultyId, ayId);
    const cur = await tx.get<Payment>(C.payments, id);
    let saved: Payment;
    if (!cur) {
      if (rev !== null) throw new UserError("Payment record not found; reload.");
      saved = await tx.create<Payment>(C.payments, { id, facultyId, academicYearId: ayId, ...v, updatedAt: nowIso() });
    } else {
      if (rev !== cur._rev) throw new UserError("This payment record was changed by someone else. Reload and try again.");
      saved = await tx.update<Payment>(C.payments, { ...cur, ...v, updatedAt: nowIso() });
    }
    await audit(tx, actor, { action: cur ? "PAYMENT_UPDATED" : "PAYMENT_CREATED", entityType: "payment", entityId: id, before: cur ?? undefined, after: saved, reason: why });
    return saved;
  });
}

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined || v === "" ? "Nil" : String(v);
  // Neutralise spreadsheet formula injection.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function consolidatedCsv(c: Consolidated): string {
  const hist = c.historyYears.map((y) => `Paid ${y.label}`);
  const head =
    c.category === "STANDARD"
      ? ["Sl No", "Name", "Designation", "Date of Joining", "FPM count", "FPM rate", "Experience in GL (years)", "Rate per point", "Minimum Points", "Points Earned", "R", "T", "S", "Payable Points", "Expected payment (calculated)", "Points status", `Paid ${c.ay.label}`, `Corrected ${c.ay.label}`, "Differential (to be paid)", ...hist]
      : ["Sl No", "Name", "Designation", "Rate INR", "R", "T", "S", "Total Points", "Minimum Points", "Points Payable", "Expected payment (calculated)", "Points status", `Paid ${c.ay.label}`, `Corrected ${c.ay.label}`, "Differential (to be paid)", ...hist];
  const lines = [head.map(csvCell).join(",")];
  for (const r of c.rows) {
    const h = c.historyYears.map((y) => r.history[y.id] ?? null);
    const common = [r.points?.R, r.points?.T, r.points?.S];
    const row =
      c.category === "STANDARD"
        ? [r.serial, r.faculty.displayName, r.designationLabel, r.faculty.dateOfJoining, r.payment?.fpmCount, r.payment?.fpmRate, r.experienceYears, r.designationRate, r.minimum, r.earned, ...common, r.pointsPayable, r.expectedPayment, r.pointsSource, r.payment?.paidAmount, r.payment?.correctedAmount, r.differential, ...h]
        : [r.serial, r.faculty.displayName, r.designationLabel, r.designationRate, ...common, r.earned, r.minimum, r.pointsPayable, r.expectedPayment, r.pointsSource, r.payment?.paidAmount, r.payment?.correctedAmount, r.differential, ...h];
    lines.push(row.map((x) => csvCell(x ?? null)).join(","));
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
