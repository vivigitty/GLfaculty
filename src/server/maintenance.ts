import { promises as fs } from "node:fs";
import path from "node:path";
import { C, createStore } from "./db";
import type { AcademicYear, PolicyRecord } from "./domain/schemas";
import { listPolicyFiles, parsePolicy, readPolicyFile } from "./policy/load";
import { SYSTEM, audit } from "./audit";
import { createFaculty, issueAccessCode } from "./services/faculty";
import type { FileStore } from "./store/fileStore";
import { env } from "./env";

/** Installs policy files as immutable versions and creates the initial academic year if none exist. */
export async function seed(store: FileStore, log: (m: string) => void = console.log): Promise<void> {
  for (const file of await listPolicyFiles()) {
    const policy = await readPolicyFile(file);
    const existing = await store.get<PolicyRecord>(C.policies, policy.version);
    if (existing) {
      // Compare normalised forms so schema defaults added later do not look like edits.
      if (JSON.stringify(parsePolicy(existing.policy, policy.version)) !== JSON.stringify(policy)) {
        log(`! ${path.basename(file)}: version ${policy.version} is already installed with different content. Policy versions are immutable — save changes under a new version.`);
      } else log(`= policy ${policy.version} already installed`);
      continue;
    }
    await store.transact(async (tx) => {
      await tx.create<PolicyRecord>(C.policies, {
        id: policy.version,
        status: "ACTIVE",
        source: path.basename(file),
        policy: JSON.parse(JSON.stringify(policy)),
        createdAt: new Date().toISOString(),
        createdBy: "seed",
        changeReason: "Installed from configuration file",
      });
      await audit(tx, SYSTEM, { action: "POLICY_INSTALLED", entityType: "policy", entityId: policy.version, reason: path.basename(file) });
    });
    log(`+ policy ${policy.version} installed`);
  }
  const years = await store.list<AcademicYear>(C.academicYears);
  if (years.length === 0) {
    // A fresh install starts on the newest installed policy version.
    const newest = (await store.list<PolicyRecord>(C.policies, (p) => p.status === "ACTIVE")).sort(
      (a, b) => String(b.policy.effectiveFrom ?? "").localeCompare(String(a.policy.effectiveFrom ?? "")) || b.id.localeCompare(a.id, undefined, { numeric: true }),
    )[0];
    if (!newest) throw new Error("No policy installed.");
    const now = new Date().toISOString();
    await store.transact(async (tx) => {
      await tx.create<AcademicYear>(C.academicYears, {
        id: "AY2025-26",
        label: "AY 2025-26",
        startDate: "2025-04-01",
        endDate: "2026-03-31",
        submissionOpenAt: "2026-04-01",
        submissionCloseAt: "2026-12-31",
        status: "OPEN",
        policyVersion: newest.id,
        historicalOnly: false,
        createdAt: now,
        updatedAt: now,
      });
      await audit(tx, SYSTEM, { action: "ACADEMIC_YEAR_CREATED", entityType: "academicYear", entityId: "AY2025-26", reason: "Initial configuration (adjust dates in Admin > Academic years)" });
    });
    log(`+ academic year AY 2025-26 created with policy ${newest.id} (submission window 2026-04-01 to 2026-12-31; change it in Admin)`);
  }
}

/** Development-only fictional faculty so the portal can be tried end-to-end. */
export async function seedDemo(log: (m: string) => void = console.log): Promise<void> {
  if (process.env.NODE_ENV === "production") throw new Error("Demo data is never created in production.");
  const actor = { role: "SYSTEM" as const, ref: "demo-seed" };
  const demo = [
    { displayName: "Demo Faculty (Professor)", email: "demo.professor@example.edu", designationKey: "PROFESSOR", facultyCategory: "STANDARD" as const, dateOfJoining: "2015-07-01" },
    { displayName: "Demo Faculty (Assistant Professor)", email: "demo.assistant@example.edu", designationKey: "ASSISTANT_PROFESSOR", facultyCategory: "STANDARD" as const, dateOfJoining: "2025-10-01" },
    { displayName: "Demo Junior Faculty", email: "demo.junior@example.edu", designationKey: "JUNIOR_FACULTY", facultyCategory: "JUNIOR" as const, dateOfJoining: "2022-01-10" },
  ];
  const lines: string[] = [];
  for (const d of demo) {
    try {
      const f = await createFaculty({ ...d, researchStatus: "RESEARCH_ACTIVE", employeeId: "", dateOfExit: "", active: true }, actor);
      const { code } = await issueAccessCode(f.id, actor);
      lines.push(`${d.displayName}: ${code}`);
      log(`+ ${d.displayName} created`);
    } catch (e) {
      log(`= ${d.displayName}: ${(e as Error).message}`);
    }
  }
  if (lines.length) {
    const file = path.resolve(env().DATA_DIR, "DEMO_ACCESS_CODES.txt");
    await fs.appendFile(file, ["# Development demo faculty access codes (fictional people)", ...lines, ""].join("\n"));
    log(`  access codes written to ${file}`);
  }
}

/** Copies the whole data directory (consistent: taken under the store's write lock). */
export async function backup(store: FileStore, destRoot: string): Promise<string> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.resolve(destRoot, `rts-backup-${stamp}`);
  await store.transact(async () => {
    await fs.cp(store.root, dest, { recursive: true, filter: (src) => !src.endsWith("_write.lock") });
  });
  await fs.writeFile(path.join(dest, "BACKUP_INFO.txt"), `RTS data backup\nsource: ${store.root}\ncreated: ${new Date().toISOString()}\n`);
  return dest;
}

/** Restores a backup into `targetDir`. The current contents are moved aside, not deleted. */
export async function restore(backupDir: string, targetDir: string): Promise<string | null> {
  const src = path.resolve(backupDir);
  await fs.access(path.join(src, "BACKUP_INFO.txt"));
  // Validate every record before touching the live directory.
  const check = createStore(src);
  for (const coll of Object.values(C)) await check.list(coll);
  const target = path.resolve(targetDir);
  let aside: string | null = null;
  try {
    await fs.access(target);
    aside = `${target}.before-restore-${Date.now()}`;
    await fs.rename(target, aside);
  } catch {
    aside = null;
  }
  await fs.cp(src, target, { recursive: true });
  return aside;
}
