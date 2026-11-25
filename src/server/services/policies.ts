import { z } from "zod";
import { C, db } from "../db";
import type { AcademicYear, Payment, PolicyRecord, Submission, SubmissionContent, SubmissionVersion } from "../domain/schemas";
import { audit, type Actor } from "../audit";
import { getPolicy, parsePolicy } from "../policy/load";
import type { Policy } from "../policy/schema";
import type { Transaction } from "../store/fileStore";
import { checkParamValue, editableParameters, type PolicyParam } from "@/lib/policyParams";
import { UserError, nowIso, reasonRequired } from "./common";

/**
 * Admin policy editing. A policy version becomes immutable once it is (or was) in use —
 * any submission scored under it beyond a draft, or any payment record for a year that
 * uses it. Editing a version in use always creates a NEW version from a base version plus
 * parameter edits. A version that has never been used may instead be edited in place
 * (`updatePolicyVersionInPlace`); the full previous policy is kept in the audit record.
 * Every change is audited with a value diff.
 */

export const policyEditInput = z.object({
  baseVersion: z.string().min(1),
  newVersion: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,39}$/, "Use 3–40 letters, digits, dots or dashes, e.g. 2026-27.v1."),
  label: z.string().trim().min(3, "Enter a short description.").max(120),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date."),
  edits: z.record(z.string().max(300), z.string().max(40)),
  assignToYearId: z.string().max(40).nullable(),
});
export type PolicyEditInput = z.input<typeof policyEditInput>;

export const policyInPlaceEditInput = z.object({
  version: z.string().min(1),
  expectedRev: z.number().int().positive(),
  label: z.string().trim().min(3, "Enter a short description.").max(120),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date."),
  edits: z.record(z.string().max(300), z.string().max(40)),
  assignToYearId: z.string().max(40).nullable(),
});
export type PolicyInPlaceEditInput = z.input<typeof policyInPlaceEditInput>;

export type PolicyUsage = { inUse: boolean; reasons: string[] };

type Reader = Pick<Transaction, "list">;

/**
 * A version is "in use" once anything has been scored or paid under it: a submission past
 * DRAFT (including rejected ones, which stay locked under their version), or a payment
 * record for an academic year that uses it. Drafts do not count — they are re-scored live.
 */
export async function policyUsage(version: string, reader: Reader = db()): Promise<PolicyUsage> {
  const subs = await reader.list<Submission>(C.submissions, (s) => s.policyVersion === version && s.status !== "DRAFT");
  const yearIds = new Set((await reader.list<AcademicYear>(C.academicYears, (y) => y.policyVersion === version)).map((y) => y.id));
  const pays = yearIds.size ? await reader.list<Payment>(C.payments, (p) => yearIds.has(p.academicYearId)) : [];
  const reasons: string[] = [];
  if (subs.length) {
    const byStatus = new Map<string, number>();
    for (const s of subs) byStatus.set(s.status, (byStatus.get(s.status) ?? 0) + 1);
    reasons.push(`${subs.length} submission(s) scored under it (${[...byStatus].map(([k, n]) => `${n} ${k.toLowerCase().replace(/_/g, " ")}`).join(", ")})`);
  }
  if (pays.length) reasons.push(`${pays.length} payment record(s) for an academic year that uses it`);
  // Submissions recomputed under a newer version still have history (versions) scored under this one.
  if (!subs.length) {
    const hist = await reader.list<SubmissionVersion>(C.submissionVersions, (v) => v.score.policyVersion === version);
    if (hist.length) reasons.push(`${hist.length} historical submission version(s) scored under it`);
  }
  return { inUse: reasons.length > 0, reasons };
}

export type ParamChange = { id: string; label: string; before: string; after: string };

function setAt(obj: unknown, path: (string | number)[], value: unknown) {
  let cur = obj as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
  const last = path[path.length - 1]!;
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}
function getAt(obj: unknown, path: (string | number)[]): unknown {
  let cur = obj as Record<string | number, unknown> | undefined;
  for (const k of path) cur = cur?.[k] as Record<string | number, unknown> | undefined;
  return cur;
}

/** Applies validated parameter edits to a deep copy of `base`. Pure; used by the service and tests. */
export function applyParameterEdits(base: Policy, edits: Record<string, string>): { raw: Record<string, unknown>; changes: ParamChange[]; errors: { path: string; message: string }[] } {
  const params = new Map<string, PolicyParam>(editableParameters(base).map((p) => [p.id, p]));
  const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  const changes: ParamChange[] = [];
  const errors: { path: string; message: string }[] = [];
  for (const [id, value] of Object.entries(edits)) {
    const p = params.get(id);
    if (!p) {
      errors.push({ path: `edits.${id}`, message: "This value cannot be edited from the portal." });
      continue;
    }
    const v = value.trim();
    if (v === p.value) continue;
    const err = checkParamValue(p, v);
    if (err) {
      errors.push({ path: `edits.${id}`, message: `${p.label}: ${err}` });
      continue;
    }
    const k = p.kind;
    if (k.type === "decimal") setAt(raw, p.path, v === "" ? null : v);
    else if (k.type === "int") setAt(raw, p.path, v === "" ? undefined : Number(v));
    else if (k.type === "bool") setAt(raw, p.path, v === "true");
    else if (k.type === "enum") setAt(raw, p.path, v);
    else if (k.type === "member") {
      // UI asks "counts?"; the stored list holds the EXCLUDED columns.
      const list = getAt(raw, p.path) as string[];
      const excluded = v === "false";
      const next = excluded ? [...new Set([...list, k.member])] : list.filter((x) => x !== k.member);
      setAt(raw, p.path, next);
    } else {
      const cell = getAt(raw, p.path) as Record<string, unknown>;
      if (v === "") {
        delete cell.factor;
        cell.range = k.range;
      } else {
        cell.factor = v;
        delete cell.range;
      }
    }
    changes.push({ id, label: `${p.group} › ${p.label}`, before: p.value || "(blank)", after: v || "(blank)" });
  }
  return { raw, changes, errors };
}

/**
 * Points a year at a policy version. Allowed at any time (owner decision 2026-11-25).
 * Drafts follow the year immediately. Submitted, under-review, clarification and approved records
 * keep the version they were scored under until the Admin explicitly recomputes them
 * (Admin → Policy changes; see services/recompute.ts) — approved records are never silently changed.
 * Rejected records stay locked under their version.
 */
export async function assignPolicyToYear(tx: Transaction, yearId: string, version: string, actor: Actor, reason: string): Promise<AcademicYear> {
  const ay = await tx.get<AcademicYear>(C.academicYears, yearId);
  if (!ay) throw new UserError("Academic year not found.", [{ path: "assignToYearId", message: "Choose an existing academic year." }]);
  if (ay.policyVersion === version) return ay;
  const all = await tx.list<Submission>(C.submissions, (s) => s.academicYearId === yearId);
  const awaitingRecompute = all.filter((s) => s.status !== "DRAFT" && s.status !== "REJECTED" && s.policyVersion !== version);
  const subs = all.filter((s) => s.status === "DRAFT");
  const now = nowIso();
  const next = await tx.update<AcademicYear>(C.academicYears, { ...ay, policyVersion: version, updatedAt: now });
  await audit(tx, actor, {
    action: "ACADEMIC_YEAR_POLICY_ASSIGNED",
    entityType: "academicYear",
    entityId: yearId,
    before: { policyVersion: ay.policyVersion },
    after: { policyVersion: version, draftsMoved: subs.length, submissionsAwaitingRecompute: awaitingRecompute.map((s) => s.id) },
    reason,
  });
  // Unsubmitted drafts move to the year's policy. Values the new policy no longer has are removed
  // from the draft (and preserved in the audit record); teaching hours are noted on the row.
  const policy = parsePolicy((await tx.require<PolicyRecord>(C.policies, version)).policy, `policy ${version}`);
  for (const d of subs) {
    const { content, removed } = fitContentToPolicy(d.content, policy);
    await tx.update<Submission>(C.submissions, { ...d, policyVersion: version, content, updatedAt: now });
    await audit(tx, actor, {
      action: "DRAFT_POLICY_UPDATED",
      entityType: "submission",
      entityId: d.id,
      before: { policyVersion: d.policyVersion, removedValues: removed },
      after: { policyVersion: version },
      reason,
    });
  }
  return next;
}

export async function createPolicyVersion(input: PolicyEditInput, reason: string, actor: Actor): Promise<{ version: string; changes: ParamChange[] }> {
  const v = policyEditInput.parse(input);
  const why = reasonRequired(reason, "creating a policy version");
  const base = await getPolicy(v.baseVersion);
  const { raw, changes, errors } = applyParameterEdits(base, v.edits);
  if (errors.length) throw new UserError("Some values are not valid. Check the highlighted fields.", errors);
  raw.version = v.newVersion;
  raw.label = v.label;
  raw.effectiveFrom = v.effectiveFrom;
  let policy: Policy;
  try {
    policy = parsePolicy(raw, `policy ${v.newVersion}`);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  return db().transact(async (tx) => {
    if (await tx.get<PolicyRecord>(C.policies, v.newVersion)) {
      throw new UserError(`Version ${v.newVersion} already exists. Policy versions are immutable — choose a new name.`, [{ path: "newVersion", message: "Already exists." }]);
    }
    await tx.create<PolicyRecord>(C.policies, {
      id: v.newVersion,
      status: "ACTIVE",
      source: `portal (from ${v.baseVersion})`,
      policy: JSON.parse(JSON.stringify(policy)) as Record<string, unknown>,
      createdAt: nowIso(),
      createdBy: actor.ref,
      changeReason: why,
    });
    await audit(tx, actor, {
      action: "POLICY_VERSION_CREATED",
      entityType: "policy",
      entityId: v.newVersion,
      before: { baseVersion: v.baseVersion },
      after: { label: v.label, effectiveFrom: v.effectiveFrom, changes },
      reason: why,
    });
    if (v.assignToYearId) await assignPolicyToYear(tx, v.assignToYearId, v.newVersion, actor, why);
    return { version: v.newVersion, changes };
  });
}

/**
 * Edits a policy version in place. Only allowed while the version has never been used
 * (see `policyUsage`); otherwise the Admin must save a new version. Drafts under the
 * version are re-scored with the new values automatically. The previous policy body is
 * preserved in the audit record so nothing is lost.
 */
export async function updatePolicyVersionInPlace(input: PolicyInPlaceEditInput, reason: string, actor: Actor): Promise<{ version: string; changes: ParamChange[] }> {
  const v = policyInPlaceEditInput.parse(input);
  const why = reasonRequired(reason, "editing a policy version");
  const base = await getPolicy(v.version);
  const { raw, changes, errors } = applyParameterEdits(base, v.edits);
  if (errors.length) throw new UserError("Some values are not valid. Check the highlighted fields.", errors);
  raw.label = v.label;
  raw.effectiveFrom = v.effectiveFrom;
  let policy: Policy;
  try {
    policy = parsePolicy(raw, `policy ${v.version}`);
  } catch (e) {
    throw new UserError((e as Error).message);
  }
  return db().transact(async (tx) => {
    const rec = await tx.require<PolicyRecord>(C.policies, v.version);
    if (rec._rev !== v.expectedRev) throw new UserError(`Policy ${v.version} was changed by someone else since you opened it. Reload and try again.`);
    const usage = await policyUsage(v.version, tx);
    if (usage.inUse) {
      throw new UserError(`Policy ${v.version} is already in use (${usage.reasons.join("; ")}), so it cannot be edited in place. Save your changes as a new version instead.`);
    }
    const meta: Record<string, { before: string; after: string }> = {};
    if (base.label !== v.label) meta.label = { before: base.label, after: v.label };
    if (base.effectiveFrom !== v.effectiveFrom) meta.effectiveFrom = { before: base.effectiveFrom, after: v.effectiveFrom };
    await tx.update<PolicyRecord>(C.policies, {
      ...rec,
      policy: JSON.parse(JSON.stringify(policy)) as Record<string, unknown>,
      changeReason: why,
    });
    await audit(tx, actor, {
      action: "POLICY_VERSION_EDITED",
      entityType: "policy",
      entityId: v.version,
      before: { rev: rec._rev, changeReason: rec.changeReason, policy: rec.policy },
      after: { ...meta, changes },
      reason: why,
    });
    if (v.assignToYearId) await assignPolicyToYear(tx, v.assignToYearId, v.version, actor, why);
    return { version: v.version, changes };
  });
}

/** Suggests the next free version name, e.g. 2025-26.v3, or 2026-27.v1 for a new year. */
export function suggestVersionName(existing: string[], yearLabel: string): string {
  for (let n = 1; ; n++) {
    const name = `${yearLabel}.v${n}`;
    if (!existing.includes(name)) return name;
  }
}

/**
 * Drops draft values the given policy does not define (service roles, disclosures, research
 * sections/fields, teaching columns) so the faculty member is never left with an error they
 * cannot clear. Returns what was removed so the caller can audit it.
 */
export function fitContentToPolicy(content: SubmissionContent, policy: Policy): { content: SubmissionContent; removed: string[] } {
  const removed: string[] = [];
  const cols = new Map(policy.teaching.columns.map((c) => [c.key, c]));
  const teaching = content.teaching.map((r) => {
    const hours: Record<string, string> = {};
    const dropped: string[] = [];
    for (const [k, h] of Object.entries(r.hours)) {
      if (cols.has(k)) hours[k] = h;
      else if (h.trim() !== "") dropped.push(`${k}: ${h} h`);
    }
    if (!dropped.length) return { ...r, hours };
    removed.push(`teaching ${r.courseName || r.id}: ${dropped.join(", ")}`);
    const note = `Re-enter under the current programme columns (was ${dropped.join(", ")}).`;
    return { ...r, hours, notes: r.notes ? `${r.notes} ${note}` : note };
  });
  const research = content.research.flatMap((e) => {
    const section = policy.researchSections.find((s) => s.key === e.sectionKey);
    if (!section) {
      removed.push(`research ${e.sectionKey} entry ${e.id}: ${JSON.stringify(e.values)}`);
      return [];
    }
    const values: typeof e.values = {};
    for (const [k, v] of Object.entries(e.values)) {
      if (section.fields.some((f) => f.key === k)) values[k] = v;
      else if (v !== null && v !== "" && v !== false) removed.push(`research ${e.sectionKey} entry ${e.id} field ${k}: ${String(v)}`);
    }
    return [{ ...e, values }];
  });
  const roleKeys = new Set(policy.service.roles.map((r) => r.key));
  const roles = Object.fromEntries(
    Object.entries(content.service.roles).filter(([k, v]) => {
      if (roleKeys.has(k)) return true;
      if (v.quantity.trim() !== "" || v.description.trim() !== "") removed.push(`service role ${k}: ${v.quantity} ${v.description}`.trim());
      return false;
    }),
  );
  const discKeys = new Set(policy.service.disclosures.map((d) => d.key));
  const disclosures = Object.fromEntries(
    Object.entries(content.service.disclosures).filter(([k, v]) => {
      if (discKeys.has(k)) return true;
      if (v.trim() !== "") removed.push(`disclosure ${k}: ${v}`);
      return false;
    }),
  );
  return { content: { ...content, teaching, research, service: { roles, disclosures } }, removed };
}
