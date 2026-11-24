import { ZodError } from "zod";
import { ConflictError, CorruptRecordError, NotFoundError } from "../store/fileStore";
import type { FieldError } from "../scoring/validate";

/** Expected business-rule failure; message is safe to show to the user. */
export class UserError extends Error {
  constructor(
    message: string,
    readonly fieldErrors: FieldError[] = [],
  ) {
    super(message);
    this.name = "UserError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: FieldError[] };

/** Wraps a server action body so expected errors become friendly results. */
export async function run<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    if (e instanceof ConflictError || e instanceof NotFoundError) return { ok: false, error: e.message };
    if (e instanceof ZodError) {
      return { ok: false, error: "Some values are invalid.", fieldErrors: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
    }
    if (e instanceof Error && e.name === "AuthError") return { ok: false, error: e.message };
    if (e instanceof CorruptRecordError) console.error("[store] corrupt record", e.message);
    else console.error("[action] unexpected error", e);
    return { ok: false, error: "Something went wrong. Please try again; if it persists, contact the RTS Admin." };
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function todayIso(): string {
  // Dates are interpreted in IST, the institution's time zone.
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

export function normalizeEmail(raw: string): string {
  const v = raw.trim();
  const at = v.lastIndexOf("@");
  if (at < 1) return v;
  return `${v.slice(0, at)}@${v.slice(at + 1).toLowerCase()}`;
}

export function reasonRequired(reason: string | undefined, what = "this change"): string {
  const r = (reason ?? "").trim();
  if (r.length < 3) throw new UserError(`A reason is required for ${what}.`, [{ path: "reason", message: "Enter a reason (at least 3 characters)." }]);
  if (r.length > 2000) throw new UserError("Reason is too long.");
  return r;
}
