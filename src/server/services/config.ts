import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { C, db } from "../db";
import type { AcademicYear, PolicyRecord } from "../domain/schemas";
import { getPolicy } from "../policy/load";
import type { Policy } from "../policy/schema";

/** Application settings (feature flags, notification switches) from config/app.yaml. */
const appSchema = z.object({
  institutionName: z.string(),
  appTitle: z.string(),
  pdfTemplateVersion: z.string(),
  features: z.object({
    facultyDirectDownload: z.boolean(),
    facultyEmailCorrectionRequests: z.boolean(),
    evidenceUploads: z.boolean(),
  }),
  notifications: z.object({
    adminOnSubmission: z.boolean(),
    facultyOnClarification: z.boolean(),
    facultyOnDecision: z.boolean(),
  }),
  email: z.object({
    maxAutomaticAttempts: z.number().int().min(1).max(5),
    templates: z.record(z.string(), z.object({ subject: z.string(), body: z.string() })),
  }),
});
export type AppConfig = z.infer<typeof appSchema>;

let appCache: AppConfig | null = null;
export async function appConfig(): Promise<AppConfig> {
  if (appCache && process.env.NODE_ENV === "production") return appCache;
  const raw = await fs.readFile(path.resolve(process.cwd(), "config", "app.yaml"), "utf8");
  appCache = appSchema.parse(YAML.parse(raw));
  return appCache;
}

export function renderTemplate(t: string, vars: Record<string, string>): string {
  return t.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}

/** The policy used for master-data lists: the newest active policy version. */
export async function currentPolicy(): Promise<Policy> {
  const recs = (await db().list<PolicyRecord>(C.policies, (p) => p.status === "ACTIVE")).sort((a, b) =>
    String(b.policy.effectiveFrom ?? "").localeCompare(String(a.policy.effectiveFrom ?? "")) || b.createdAt.localeCompare(a.createdAt),
  );
  const top = recs[0];
  if (!top) throw new Error('No policy installed. Run "npm run seed".');
  return getPolicy(top.id);
}

export async function policyForYear(ay: AcademicYear): Promise<Policy> {
  return getPolicy(ay.policyVersion);
}
