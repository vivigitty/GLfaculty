import { z } from "zod";
import { decimalString } from "../policy/schema";

/** Record schemas for every YAML collection. Field names follow DESIGN.md §5. */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
const isoDateTime = z.string().datetime({ offset: true });
const base = { id: z.string(), _rev: z.number().int().positive() };

export const ROLES = ["ADMIN", "FACULTY", "SYSTEM"] as const;
export type ActorRole = (typeof ROLES)[number];

export const FACULTY_CATEGORIES = ["STANDARD", "JUNIOR"] as const;
export type FacultyCategory = (typeof FACULTY_CATEGORIES)[number];

// ---------------------------------------------------------------- Faculty master
export const facultySchema = z.object({
  ...base,
  displayName: z.string().min(1),
  email: z.string().email(),
  designationKey: z.string(),
  facultyCategory: z.enum(FACULTY_CATEGORIES),
  dateOfJoining: isoDate.nullable(),
  /** Last working day for faculty leaving during a year (prorates the minimum). */
  dateOfExit: isoDate.nullable().optional(),
  researchStatus: z.string(),
  employeeId: z.string().nullable(),
  /** Retired from the form by owner decision (2026-11); kept so historical records still read. */
  hasPhd: z.enum(["YES", "NO"]).nullable().optional(),
  active: z.boolean(),
  access: z.object({
    status: z.enum(["PENDING_ISSUE", "ACTIVE", "REVOKED"]),
    secretHash: z.string().nullable(),
    issuedAt: isoDateTime.nullable(),
    revokedAt: isoDateTime.nullable(),
    generation: z.number().int().nonnegative(),
  }),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Faculty = z.infer<typeof facultySchema>;

// ---------------------------------------------------------------- Academic year
export const academicYearSchema = z.object({
  ...base,
  label: z.string().min(1),
  startDate: isoDate,
  endDate: isoDate,
  submissionOpenAt: isoDate,
  submissionCloseAt: isoDate,
  status: z.enum(["UPCOMING", "OPEN", "CLOSED"]),
  policyVersion: z.string(),
  historicalOnly: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type AcademicYear = z.infer<typeof academicYearSchema>;

// ---------------------------------------------------------------- Policy versions
export const policyRecordSchema = z.object({
  ...base,
  status: z.enum(["ACTIVE", "RETIRED"]),
  source: z.string(),
  policy: z.record(z.string(), z.unknown()),
  createdAt: isoDateTime,
  createdBy: z.string(),
  changeReason: z.string(),
});
export type PolicyRecord = z.infer<typeof policyRecordSchema>;

// ---------------------------------------------------------------- Submission content
const cell = z.union([z.string(), z.boolean(), z.null()]);

export const teachingRowSchema = z.object({
  id: z.string(),
  courseName: z.string(),
  courseType: z.string(),
  sections: z.string(),
  students: z.string(),
  feedback: z.string(),
  hours: z.record(z.string(), z.string()),
  notes: z.string(),
});
export type TeachingRow = z.infer<typeof teachingRowSchema>;

export const researchEntrySchema = z.object({
  id: z.string(),
  sectionKey: z.string(),
  values: z.record(z.string(), cell),
});
export type ResearchEntry = z.infer<typeof researchEntrySchema>;

export const submissionContentSchema = z.object({
  teaching: z.array(teachingRowSchema),
  research: z.array(researchEntrySchema),
  service: z.object({
    roles: z.record(z.string(), z.object({ quantity: z.string(), description: z.string() })),
    disclosures: z.record(z.string(), z.string()),
  }),
  facultyNotes: z.string(),
});
export type SubmissionContent = z.infer<typeof submissionContentSchema>;

export const emptyContent = (): SubmissionContent => ({
  teaching: [],
  research: [],
  service: { roles: {}, disclosures: {} },
  facultyNotes: "",
});

// ---------------------------------------------------------------- Score snapshot
export const CATEGORIES = ["R", "T", "S"] as const;
export type Category = (typeof CATEGORIES)[number];

export const scoreLineSchema = z.object({
  lineId: z.string(),
  category: z.enum(CATEGORIES),
  section: z.string(),
  label: z.string(),
  detail: z.string(),
  basePoints: decimalString,
  multiplier: decimalString,
  points: decimalString,
  compensationEligible: z.boolean(),
  reviewRequired: z.boolean(),
  explanation: z.string(),
});
export type ScoreLine = z.infer<typeof scoreLineSchema>;

export const rtsSchema = z.object({ R: decimalString, T: decimalString, S: decimalString });
export type RTS = z.infer<typeof rtsSchema>;

export const scoreSnapshotSchema = z.object({
  policyVersion: z.string(),
  calculatedAt: isoDateTime,
  lines: z.array(scoreLineSchema),
  totals: rtsSchema,
  teachingInfo: z.object({
    totalHours: decimalString,
    cldHours: decimalString,
    hoursForPoints: decimalString,
    capHours: decimalString,
    hoursCountedForCap: decimalString,
    contractualLoadHours: decimalString,
    cldCompensation: decimalString.nullable(),
  }),
  warnings: z.array(z.object({ code: z.string(), message: z.string(), lineId: z.string().nullable() })),
});
export type ScoreSnapshot = z.infer<typeof scoreSnapshotSchema>;

// ---------------------------------------------------------------- Submission
export const SUBMISSION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "NEEDS_CLARIFICATION",
  "APPROVED",
  "REJECTED",
] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const LINE_REVIEW_STATUSES = ["UNVERIFIED", "VERIFIED", "DISPUTED", "NEEDS_EVIDENCE"] as const;

export const facultySnapshotSchema = z.object({
  displayName: z.string(),
  email: z.string(),
  designationKey: z.string(),
  facultyCategory: z.enum(FACULTY_CATEGORIES),
  dateOfJoining: isoDate.nullable(),
  dateOfExit: isoDate.nullable().optional(),
  researchStatus: z.string(),
  hasPhd: z.enum(["YES", "NO"]).nullable().optional(),
});
export type FacultySnapshot = z.infer<typeof facultySnapshotSchema>;

export const submissionSchema = z.object({
  ...base,
  academicYearId: z.string(),
  facultyId: z.string(),
  status: z.enum(SUBMISSION_STATUSES),
  policyVersion: z.string(),
  content: submissionContentSchema,
  declaration: z.object({ accepted: z.boolean(), acceptedAt: isoDateTime }).nullable(),
  currentVersion: z.number().int().nonnegative(),
  facultySnapshot: facultySnapshotSchema.nullable(),
  /** Immutable once written for a version: the score the faculty submitted. */
  submittedScore: scoreSnapshotSchema.nullable(),
  /** Six category values. submitted = submittedScore.totals; approved is Admin-editable until approval. */
  submittedPoints: rtsSchema.nullable(),
  approvedPoints: rtsSchema.nullable(),
  /** Admin remark per category, required whenever approved differs from submitted; printed on the final PDF. */
  categoryRemarks: z
    .object({ R: z.string().optional(), T: z.string().optional(), S: z.string().optional() })
    .optional(),
  lineReviews: z.record(
    z.string(),
    z.object({
      status: z.enum(LINE_REVIEW_STATUSES),
      note: z.string(),
      approvedPoints: decimalString.nullable(),
      reason: z.string(),
      updatedAt: isoDateTime,
    }),
  ),
  messages: z.array(
    z.object({
      id: z.string(),
      at: isoDateTime,
      from: z.enum(["ADMIN", "FACULTY"]),
      kind: z.enum(["CLARIFICATION_REQUEST", "FACULTY_RESPONSE", "ADMIN_NOTE", "DECISION"]),
      message: z.string(),
    }),
  ),
  adminNotes: z.string(),
  submittedAt: isoDateTime.nullable(),
  approvedAt: isoDateTime.nullable(),
  rejectedAt: isoDateTime.nullable(),
  locked: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Submission = z.infer<typeof submissionSchema>;

/**
 * Remark explaining why approved points differ from submitted for one category: the Admin's
 * category remark plus the reasons of any line-level overrides in that category.
 */
export function categoryRemark(sub: Pick<Submission, "categoryRemarks" | "lineReviews" | "submittedScore">, cat: Category): string {
  const parts: string[] = [];
  const main = sub.categoryRemarks?.[cat]?.trim();
  if (main) parts.push(main);
  for (const [lineId, r] of Object.entries(sub.lineReviews)) {
    if (!lineId.startsWith(`${cat}:`) || r.approvedPoints === null || !r.reason.trim()) continue;
    const line = sub.submittedScore?.lines.find((l) => l.lineId === lineId);
    parts.push(`${line?.detail ?? lineId}: ${r.reason.trim()}`);
  }
  return parts.join("; ");
}

export const submissionVersionSchema = z.object({
  ...base,
  submissionId: z.string(),
  versionNumber: z.number().int().positive(),
  kind: z.enum(["SUBMITTED", "RESUBMITTED", "ADMIN_CORRECTION", "APPROVED_SNAPSHOT"]),
  content: submissionContentSchema,
  facultySnapshot: facultySnapshotSchema,
  score: scoreSnapshotSchema,
  submittedPoints: rtsSchema,
  approvedPoints: rtsSchema,
  createdAt: isoDateTime,
  createdByRole: z.enum(ROLES),
  reason: z.string(),
});
export type SubmissionVersion = z.infer<typeof submissionVersionSchema>;

// ---------------------------------------------------------------- Exports & email
export const exportFileSchema = z.object({
  ...base,
  submissionId: z.string(),
  versionNumber: z.number().int(),
  kind: z.enum(["INITIAL", "FINAL", "REGENERATED"]),
  format: z.literal("PDF"),
  templateVersion: z.string(),
  fileName: z.string(),
  storageKey: z.string(),
  checksum: z.string(),
  sizeBytes: z.number().int(),
  generatedAt: isoDateTime,
  generatedByRole: z.enum(ROLES),
});
export type ExportFile = z.infer<typeof exportFileSchema>;

export const EMAIL_STATUSES = ["QUEUED", "SEND_ACCEPTED", "DELIVERED", "BOUNCED", "FAILED"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

export const emailAttemptSchema = z.object({
  ...base,
  submissionId: z.string().nullable(),
  exportId: z.string().nullable(),
  facultyId: z.string().nullable(),
  purpose: z.enum(["INITIAL_EXPORT", "FINAL_EXPORT", "RESEND_EXPORT", "STATUS_NOTICE", "ADMIN_NOTICE"]),
  recipientEmail: z.string(),
  subject: z.string(),
  attemptNumber: z.number().int().positive(),
  idempotencyKey: z.string(),
  provider: z.string(),
  status: z.enum(EMAIL_STATUSES),
  providerMessageId: z.string().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  queuedAt: isoDateTime,
  acceptedAt: isoDateTime.nullable(),
  deliveredAt: isoDateTime.nullable(),
  bouncedAt: isoDateTime.nullable(),
  failedAt: isoDateTime.nullable(),
  events: z.array(z.object({ type: z.string(), at: isoDateTime, detail: z.string() })),
});
export type EmailAttempt = z.infer<typeof emailAttemptSchema>;

export const receiptSchema = z.object({
  ...base,
  submissionId: z.string(),
  facultyId: z.string(),
  emailAttemptId: z.string().nullable(),
  response: z.enum(["YES_RECEIVED", "NO_NOT_RECEIVED"]),
  addressShown: z.string(),
  followUp: z.enum(["NONE", "ADDRESS_CORRECT_NOT_RECEIVED", "CORRECTION_REQUESTED", "PENDING_ANSWER"]),
  notes: z.string(),
  confirmedAt: isoDateTime,
  resolved: z.boolean(),
  resolvedAt: isoDateTime.nullable(),
  resolutionNote: z.string(),
});
export type Receipt = z.infer<typeof receiptSchema>;

export const emailCorrectionSchema = z.object({
  ...base,
  facultyId: z.string(),
  submissionId: z.string().nullable(),
  oldEmail: z.string(),
  requestedEmail: z.string().email(),
  explanation: z.string(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]),
  requestedAt: isoDateTime,
  reviewedAt: isoDateTime.nullable(),
  reviewReason: z.string(),
});
export type EmailCorrection = z.infer<typeof emailCorrectionSchema>;

// ---------------------------------------------------------------- Payments
export const paymentSchema = z.object({
  ...base,
  facultyId: z.string(),
  academicYearId: z.string(),
  paidAmount: decimalString.nullable(),
  correctedAmount: decimalString.nullable(),
  fpmCount: decimalString.nullable(),
  fpmRate: decimalString.nullable(),
  paymentReference: z.string(),
  notes: z.string(),
  imported: z.boolean(),
  updatedAt: isoDateTime,
});
export type Payment = z.infer<typeof paymentSchema>;

// ---------------------------------------------------------------- Sessions & audit
export const sessionSchema = z.object({
  ...base,
  role: z.enum(["ADMIN", "FACULTY"]),
  facultyId: z.string().nullable(),
  accessGeneration: z.number().int().nullable(),
  createdAt: isoDateTime,
  expiresAt: isoDateTime,
  revoked: z.boolean(),
});
export type Session = z.infer<typeof sessionSchema>;

export const auditSchema = z.object({
  ...base,
  at: isoDateTime,
  actorRole: z.enum(ROLES),
  actorRef: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  reason: z.string(),
});
export type AuditEvent = z.infer<typeof auditSchema>;
