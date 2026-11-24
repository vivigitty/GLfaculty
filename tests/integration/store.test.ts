import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { ConflictError, CorruptRecordError, FileStore } from "@/server/store/fileStore";

const schema = z.object({ id: z.string(), _rev: z.number(), name: z.string(), n: z.number() });
type Rec = z.infer<typeof schema>;

let dir: string;
let store: FileStore;
const mk = (root: string) => {
  const s = new FileStore(root);
  s.register("things", schema);
  return s;
};

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "rts-store-"));
  store = mk(dir);
});
afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("FileStore", () => {
  it("creates, reads and updates YAML records with revisions", async () => {
    await store.transact((tx) => tx.create<Rec>("things", { id: "a", name: "first", n: 1 }));
    const a = await store.require<Rec>("things", "a");
    expect(a._rev).toBe(1);
    const raw = await fs.readFile(path.join(dir, "things", "a.yaml"), "utf8");
    expect(YAML.parse(raw)).toMatchObject({ id: "a", name: "first" });
    await store.transact((tx) => tx.update<Rec>("things", { ...a, n: 2 }));
    expect((await store.require<Rec>("things", "a"))._rev).toBe(2);
  });

  it("rejects stale updates (lost-update protection)", async () => {
    const stale = await store.require<Rec>("things", "a");
    await store.transact((tx) => tx.update<Rec>("things", { ...stale, n: 3 }));
    await expect(store.transact((tx) => tx.update<Rec>("things", { ...stale, n: 99 }))).rejects.toBeInstanceOf(ConflictError);
    expect((await store.require<Rec>("things", "a")).n).toBe(3);
  });

  it("discards all staged writes when the transaction throws", async () => {
    await expect(
      store.transact(async (tx) => {
        await tx.create<Rec>("things", { id: "b", name: "b", n: 1 });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await store.get("things", "b")).toBeNull();
  });

  it("serialises concurrent writers", async () => {
    await store.transact((tx) => tx.create<Rec>("things", { id: "c", name: "counter", n: 0 }));
    await Promise.all(
      Array.from({ length: 20 }, () =>
        store.transact(async (tx) => {
          const c = await tx.require<Rec>("things", "c");
          await tx.update<Rec>("things", { ...c, n: c.n + 1 });
        }),
      ),
    );
    expect((await store.require<Rec>("things", "c")).n).toBe(20);
  });

  it("replays an interrupted multi-file transaction from the journal", async () => {
    const d2 = await fs.mkdtemp(path.join(os.tmpdir(), "rts-journal-"));
    const content = (id: string) => YAML.stringify({ id, _rev: 1, name: id, n: 1 });
    // Simulate a crash after the journal was written but before files were applied.
    await fs.writeFile(path.join(d2, "_journal.yaml"), YAML.stringify({ writes: [{ rel: "things/x.yaml", content: content("x") }, { rel: "things/y.yaml", content: content("y") }] }));
    const s2 = mk(d2);
    expect((await s2.list<Rec>("things")).map((r) => r.id)).toEqual(["x", "y"]);
    await expect(fs.access(path.join(d2, "_journal.yaml"))).rejects.toThrow();
    await fs.rm(d2, { recursive: true, force: true });
  });

  it("refuses invalid records on write and flags corrupt files on read", async () => {
    await expect(store.transact((tx) => tx.create("things", { id: "bad", name: 5 } as unknown as Rec))).rejects.toThrow(/Invalid things record/);
    await fs.writeFile(path.join(dir, "things", "corrupt.yaml"), "id: corrupt\n_rev: 1\nname: [unclosed\n");
    await expect(store.get("things", "corrupt")).rejects.toBeInstanceOf(CorruptRecordError);
    await fs.rm(path.join(dir, "things", "corrupt.yaml"));
  });

  it("rejects path traversal in ids", async () => {
    await expect(store.get("things", "../evil")).rejects.toThrow(/Invalid record id/);
  });
});
