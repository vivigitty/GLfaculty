import { promises as fs, constants as fsc } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import YAML from "yaml";
import type { ZodType } from "zod";

/**
 * File-backed document store: one YAML file per record.
 *
 * Guarantees (see docs/adr/0001-yaml-file-storage.md):
 *  - atomic single-file writes (temp file + fsync + rename)
 *  - all-or-nothing multi-file transactions via a write-ahead journal
 *  - single writer (in-process mutex + exclusive lock file across processes)
 *  - optimistic concurrency through a `_rev` counter on every record
 *  - schema validation on every read and write
 */

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
export class CorruptRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorruptRecordError";
  }
}

export type BaseRecord = { id: string; _rev: number };

type PendingWrite = { rel: string; content: string | null; binary?: boolean };

const JOURNAL = "_journal.yaml";
const LOCK = "_write.lock";
const STALE_LOCK_MS = 30_000;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,120}$/;

export function newId(prefix: string): string {
  const t = Date.now().toString(36).padStart(9, "0");
  return `${prefix}_${t}${crypto.randomBytes(5).toString("hex")}`;
}

async function atomicWrite(file: string, data: string | Buffer): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  const fh = await fs.open(tmp, "w");
  try {
    await fh.writeFile(data);
    await fh.sync();
  } finally {
    await fh.close();
  }
  // rename is atomic on the same volume; retry briefly for Windows AV/indexer locks
  for (let i = 0; ; i++) {
    try {
      await fs.rename(tmp, file);
      return;
    } catch (e) {
      if (i >= 8) {
        await fs.rm(tmp, { force: true });
        throw e;
      }
      await new Promise((r) => setTimeout(r, 25 * (i + 1)));
    }
  }
}

type GlobalState = { chains: Map<string, Promise<unknown>>; recovered: Set<string> };
const g = globalThis as unknown as { __rtsStore?: GlobalState };
const state: GlobalState = (g.__rtsStore ??= { chains: new Map(), recovered: new Set() });

export class FileStore {
  readonly root: string;
  private schemas = new Map<string, ZodType>();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  register<T extends BaseRecord>(collection: string, schema: ZodType<T>): void {
    this.schemas.set(collection, schema);
  }

  private relPath(collection: string, id: string): string {
    if (!this.schemas.has(collection)) throw new Error(`Unknown collection ${collection}`);
    if (!ID_RE.test(id)) throw new Error(`Invalid record id "${id}"`);
    return path.join(collection, `${id}.yaml`);
  }

  private parse<T>(collection: string, raw: string, where: string): T {
    let obj: unknown;
    try {
      obj = YAML.parse(raw);
    } catch (e) {
      throw new CorruptRecordError(`${where}: invalid YAML (${(e as Error).message})`);
    }
    const schema = this.schemas.get(collection);
    if (!schema) throw new Error(`Unknown collection ${collection}`);
    const res = schema.safeParse(obj);
    if (!res.success) {
      throw new CorruptRecordError(`${where}: ${res.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    }
    return res.data as T;
  }

  serialize(collection: string, record: unknown): string {
    const schema = this.schemas.get(collection);
    if (!schema) throw new Error(`Unknown collection ${collection}`);
    const res = schema.safeParse(record);
    if (!res.success) {
      throw new Error(`Invalid ${collection} record: ${res.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
    }
    return YAML.stringify(res.data, { lineWidth: 0, aliasDuplicateObjects: false });
  }

  /** Replays an interrupted transaction, if any. Idempotent. */
  async recover(): Promise<void> {
    if (state.recovered.has(this.root)) return;
    await this.withLock(async () => {
      await this.replayJournal();
    });
    state.recovered.add(this.root);
  }

  private async replayJournal(): Promise<void> {
    const jp = path.join(this.root, JOURNAL);
    let raw: string;
    try {
      raw = await fs.readFile(jp, "utf8");
    } catch {
      return;
    }
    const journal = YAML.parse(raw) as { writes: PendingWrite[] } | null;
    if (journal?.writes) await this.applyWrites(journal.writes);
    await fs.rm(jp, { force: true });
  }

  private async applyWrites(writes: PendingWrite[]): Promise<void> {
    for (const w of writes) {
      const abs = path.join(this.root, w.rel);
      if (w.content === null) await fs.rm(abs, { force: true });
      else await atomicWrite(abs, w.binary ? Buffer.from(w.content, "base64") : w.content);
    }
  }

  async get<T extends BaseRecord>(collection: string, id: string): Promise<T | null> {
    await this.recover();
    const rel = this.relPath(collection, id);
    try {
      const raw = await fs.readFile(path.join(this.root, rel), "utf8");
      return this.parse<T>(collection, raw, rel);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }

  async require<T extends BaseRecord>(collection: string, id: string): Promise<T> {
    const r = await this.get<T>(collection, id);
    if (!r) throw new NotFoundError(`${collection}/${id} not found`);
    return r;
  }

  async list<T extends BaseRecord>(collection: string, filter?: (r: T) => boolean): Promise<T[]> {
    await this.recover();
    if (!this.schemas.has(collection)) throw new Error(`Unknown collection ${collection}`);
    const dir = path.join(this.root, collection);
    let names: string[];
    try {
      names = (await fs.readdir(dir)).filter((n) => n.endsWith(".yaml")).sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const out: T[] = [];
    for (const n of names) {
      const raw = await fs.readFile(path.join(dir, n), "utf8");
      const rec = this.parse<T>(collection, raw, path.join(collection, n));
      if (!filter || filter(rec)) out.push(rec);
    }
    return out;
  }

  async readFile(rel: string): Promise<Buffer> {
    await this.recover();
    const abs = path.resolve(this.root, rel);
    if (!abs.startsWith(this.root + path.sep)) throw new Error("Path escapes data directory");
    return fs.readFile(abs);
  }

  /** Serializes writers in this process and across processes sharing the directory. */
  private async withLock<R>(fn: () => Promise<R>): Promise<R> {
    const prev = state.chains.get(this.root) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const chain = prev.then(() => mine);
    state.chains.set(this.root, chain);
    await prev.catch(() => undefined);
    try {
      await fs.mkdir(this.root, { recursive: true });
      const lockPath = path.join(this.root, LOCK);
      await this.acquireFileLock(lockPath);
      try {
        return await fn();
      } finally {
        await fs.rm(lockPath, { force: true });
      }
    } finally {
      release();
      if (state.chains.get(this.root) === chain) state.chains.delete(this.root);
    }
  }

  private async acquireFileLock(lockPath: string): Promise<void> {
    const deadline = Date.now() + 15_000;
    for (;;) {
      try {
        const fh = await fs.open(lockPath, fsc.O_CREAT | fsc.O_EXCL | fsc.O_WRONLY);
        await fh.writeFile(JSON.stringify({ pid: process.pid, at: Date.now() }));
        await fh.close();
        return;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
        try {
          const st = await fs.stat(lockPath);
          if (Date.now() - st.mtimeMs > STALE_LOCK_MS) {
            await fs.rm(lockPath, { force: true });
            continue;
          }
        } catch {
          continue;
        }
        if (Date.now() > deadline) throw new ConflictError("Data store is busy; please retry.");
        await new Promise((r) => setTimeout(r, 30));
      }
    }
  }

  /**
   * Runs `fn` with exclusive write access. Writes staged through the transaction
   * are committed atomically when `fn` resolves, and discarded if it throws.
   */
  async transact<R>(fn: (tx: Transaction) => Promise<R>): Promise<R> {
    await this.recover();
    return this.withLock(async () => {
      await this.replayJournal();
      const tx = new Transaction(this);
      const result = await fn(tx);
      const writes = tx.pending();
      if (writes.length > 0) {
        const jp = path.join(this.root, JOURNAL);
        await atomicWrite(jp, YAML.stringify({ at: new Date().toISOString(), writes }, { lineWidth: 0 }));
        await this.applyWrites(writes);
        await fs.rm(jp, { force: true });
      }
      return result;
    });
  }

  /** @internal used by Transaction */
  _rel(collection: string, id: string) {
    return this.relPath(collection, id);
  }
}

export class Transaction {
  private staged = new Map<string, PendingWrite>();
  private stagedDocs = new Map<string, BaseRecord | null>();

  constructor(private store: FileStore) {}

  async get<T extends BaseRecord>(collection: string, id: string): Promise<T | null> {
    const rel = this.store._rel(collection, id);
    if (this.stagedDocs.has(rel)) return (this.stagedDocs.get(rel) as T | null) ?? null;
    return this.store.get<T>(collection, id);
  }

  async require<T extends BaseRecord>(collection: string, id: string): Promise<T> {
    const r = await this.get<T>(collection, id);
    if (!r) throw new NotFoundError(`${collection}/${id} not found`);
    return r;
  }

  list<T extends BaseRecord>(collection: string, filter?: (r: T) => boolean): Promise<T[]> {
    return this.store.list<T>(collection, filter);
  }

  /** Creates a new record; fails if the id already exists. Returns the stored record. */
  async create<T extends BaseRecord>(collection: string, record: Omit<T, "_rev"> & { _rev?: number }): Promise<T> {
    const existing = await this.get(collection, record.id);
    if (existing) throw new ConflictError(`${collection}/${record.id} already exists`);
    const doc = { ...record, _rev: 1 } as T;
    this.stage(collection, doc);
    return doc;
  }

  /**
   * Updates a record. `record._rev` must equal the revision currently stored,
   * otherwise someone else changed it since it was read.
   */
  async update<T extends BaseRecord>(collection: string, record: T): Promise<T> {
    const current = await this.get<T>(collection, record.id);
    if (!current) throw new NotFoundError(`${collection}/${record.id} not found`);
    if (current._rev !== record._rev) {
      throw new ConflictError(`This ${collection.replace(/s$/, "")} was changed by someone else. Reload and try again.`);
    }
    const doc = { ...record, _rev: record._rev + 1 } as T;
    this.stage(collection, doc);
    return doc;
  }

  /** Deletes a record. Only used for ephemeral data (expired sessions). */
  delete(collection: string, id: string): void {
    const rel = this.store._rel(collection, id);
    this.staged.set(rel, { rel, content: null });
    this.stagedDocs.set(rel, null);
  }

  writeFile(rel: string, data: Buffer): void {
    if (rel.includes("..") || path.isAbsolute(rel)) throw new Error("Invalid file path");
    this.staged.set(rel, { rel, content: data.toString("base64"), binary: true });
  }

  private stage(collection: string, doc: BaseRecord) {
    const rel = this.store._rel(collection, doc.id);
    const content = this.store.serialize(collection, doc);
    this.staged.set(rel, { rel, content });
    this.stagedDocs.set(rel, doc);
  }

  pending(): PendingWrite[] {
    return [...this.staged.values()];
  }
}
