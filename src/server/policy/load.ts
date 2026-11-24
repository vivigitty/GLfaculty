import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { policySchema, type Policy } from "./schema";
import { C, db } from "../db";
import type { PolicyRecord } from "../domain/schemas";
import { NotFoundError } from "../store/fileStore";

export const POLICY_DIR = path.resolve(process.cwd(), "config", "policy");

export function parsePolicy(raw: unknown, where = "policy"): Policy {
  const res = policySchema.safeParse(raw);
  if (!res.success) {
    throw new Error(`${where} is invalid:\n${res.error.issues.map((i) => ` - ${i.path.join(".")}: ${i.message}`).join("\n")}`);
  }
  return res.data;
}

export async function readPolicyFile(file: string): Promise<Policy> {
  return parsePolicy(YAML.parse(await fs.readFile(file, "utf8")), path.basename(file));
}

export async function listPolicyFiles(): Promise<string[]> {
  const names = await fs.readdir(POLICY_DIR);
  return names.filter((n) => n.endsWith(".yaml") || n.endsWith(".yml")).map((n) => path.join(POLICY_DIR, n));
}

const cache = new Map<string, { rev: number; policy: Policy }>();

/** Loads an immutable policy version from the data store. */
export async function getPolicy(version: string): Promise<Policy> {
  const rec = await db().get<PolicyRecord>(C.policies, version);
  if (!rec) throw new NotFoundError(`Policy version ${version} is not installed. Run "npm run seed".`);
  const hit = cache.get(version);
  if (hit && hit.rev === rec._rev) return hit.policy;
  const policy = parsePolicy(rec.policy, `policy ${version}`);
  cache.set(version, { rev: rec._rev, policy });
  return policy;
}

export async function listPolicies(): Promise<PolicyRecord[]> {
  return db().list<PolicyRecord>(C.policies);
}
