import crypto from "node:crypto";
import { C, db } from "../db";
import type { AcademicYear, ExportFile, Submission } from "../domain/schemas";
import { newId } from "../store/fileStore";
import { audit, type Actor } from "../audit";
import { renderSubmissionPdf } from "../exports/pdf";
import { eligibilityAndPayment } from "../scoring/engine";
import { getPolicy } from "../policy/load";
import { appConfig } from "./config";
import { nowIso } from "./common";

/**
 * Generates (or reuses, for idempotency) the PDF for a submission version.
 * The file is written in the same transaction as its metadata record.
 */
export async function generateExport(submissionId: string, kind: ExportFile["kind"], actor: Actor): Promise<ExportFile> {
  const sub = await db().require<Submission>(C.submissions, submissionId);
  if (!sub.submittedScore || !sub.submittedPoints || !sub.facultySnapshot) throw new Error("Submission has not been submitted");
  if (kind !== "REGENERATED") {
    const existing = await db().list<ExportFile>(C.exports, (e) => e.submissionId === submissionId && e.versionNumber === sub.currentVersion && e.kind === kind && (kind === "INITIAL" || e.generatedAt >= (sub.approvedAt ?? "")));
    if (existing[0]) return existing[0];
  }
  const ay = await db().require<AcademicYear>(C.academicYears, sub.academicYearId);
  const policy = await getPolicy(sub.policyVersion);
  const cfg = await appConfig();
  const period = { startDate: ay.startDate, endDate: ay.endDate };
  const generatedAt = nowIso();
  const pdf = await renderSubmissionPdf({
    institution: cfg.institutionName,
    templateVersion: cfg.pdfTemplateVersion,
    kind,
    generatedAt,
    submission: sub,
    ay,
    policy,
    submittedElig: eligibilityAndPayment(sub.submittedPoints, policy, sub.facultySnapshot, period),
    approvedElig: eligibilityAndPayment(sub.approvedPoints ?? sub.submittedPoints, policy, sub.facultySnapshot, period),
  });
  const id = newId("exp");
  const storageKey = `files/exports/${id}.pdf`;
  const safeName = sub.facultySnapshot.displayName.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "faculty";
  return db().transact(async (tx) => {
    tx.writeFile(storageKey, pdf);
    const rec = await tx.create<ExportFile>(C.exports, {
      id,
      submissionId,
      versionNumber: sub.currentVersion,
      kind,
      format: "PDF",
      templateVersion: cfg.pdfTemplateVersion,
      fileName: `RTS_${ay.label.replace(/[^A-Za-z0-9-]+/g, "_")}_${safeName}_${kind.toLowerCase()}_v${sub.currentVersion}.pdf`,
      storageKey,
      checksum: crypto.createHash("sha256").update(pdf).digest("hex"),
      sizeBytes: pdf.length,
      generatedAt,
      generatedByRole: actor.role,
    });
    await audit(tx, actor, { action: "EXPORT_GENERATED", entityType: "export", entityId: id, after: { submissionId, kind, version: sub.currentVersion, checksum: rec.checksum } });
    return rec;
  });
}

export async function exportsFor(submissionId: string): Promise<ExportFile[]> {
  return (await db().list<ExportFile>(C.exports, (e) => e.submissionId === submissionId)).sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}
