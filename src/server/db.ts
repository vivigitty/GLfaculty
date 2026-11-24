import path from "node:path";
import { FileStore } from "./store/fileStore";
import {
  academicYearSchema,
  auditSchema,
  emailAttemptSchema,
  emailCorrectionSchema,
  exportFileSchema,
  facultySchema,
  paymentSchema,
  policyRecordSchema,
  receiptSchema,
  sessionSchema,
  submissionSchema,
  submissionVersionSchema,
} from "./domain/schemas";
import { env } from "./env";

/** Collection names = sub-directories of DATA_DIR. */
export const C = {
  faculty: "faculty",
  academicYears: "academic-years",
  policies: "policies",
  submissions: "submissions",
  submissionVersions: "submission-versions",
  exports: "exports",
  emailAttempts: "email-attempts",
  receipts: "email-receipts",
  emailCorrections: "email-corrections",
  payments: "payments",
  sessions: "sessions",
  audit: "audit",
} as const;

export function createStore(dir: string): FileStore {
  const s = new FileStore(dir);
  s.register(C.faculty, facultySchema);
  s.register(C.academicYears, academicYearSchema);
  s.register(C.policies, policyRecordSchema);
  s.register(C.submissions, submissionSchema);
  s.register(C.submissionVersions, submissionVersionSchema);
  s.register(C.exports, exportFileSchema);
  s.register(C.emailAttempts, emailAttemptSchema);
  s.register(C.receipts, receiptSchema);
  s.register(C.emailCorrections, emailCorrectionSchema);
  s.register(C.payments, paymentSchema);
  s.register(C.sessions, sessionSchema);
  s.register(C.audit, auditSchema);
  return s;
}

const g = globalThis as unknown as { __rtsDb?: { dir: string; store: FileStore } };

export function db(): FileStore {
  const dir = path.resolve(env().DATA_DIR);
  if (!g.__rtsDb || g.__rtsDb.dir !== dir) g.__rtsDb = { dir, store: createStore(dir) };
  return g.__rtsDb.store;
}
