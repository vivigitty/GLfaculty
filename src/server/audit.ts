import { C } from "./db";
import type { ActorRole, AuditEvent } from "./domain/schemas";
import { newId, type Transaction } from "./store/fileStore";

export type Actor = { role: ActorRole; ref: string };
export const SYSTEM: Actor = { role: "SYSTEM", ref: "system" };

/** Writes an audit event inside the same transaction as the change it records. */
export async function audit(
  tx: Transaction,
  actor: Actor,
  e: { action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; reason?: string },
): Promise<void> {
  await tx.create<AuditEvent>(C.audit, {
    id: newId("aud"),
    at: new Date().toISOString(),
    actorRole: actor.role,
    actorRef: actor.ref,
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    before: e.before === undefined ? undefined : JSON.parse(JSON.stringify(e.before)),
    after: e.after === undefined ? undefined : JSON.parse(JSON.stringify(e.after)),
    reason: e.reason ?? "",
  });
}
