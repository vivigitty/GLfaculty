import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { C, db } from "../db";
import type { Faculty, Session } from "../domain/schemas";
import { env, sessionSecret } from "../env";
import { newId } from "../store/fileStore";
import { audit, type Actor } from "../audit";
import { normalizeAccessCode, verifySecret } from "./secrets";
import { isLocked, recordFailure, recordSuccess } from "./rateLimit";

/**
 * Framework-independent authentication logic (unit-testable without Next.js).
 * Cookies carry only `<sessionId>.<hmac>`; the session itself lives in the store
 * so it can be revoked server-side.
 */

export const GENERIC_LOGIN_ERROR = "Sign-in failed. Check your selection and access code, or contact the RTS Admin.";
export const LOCKED_ERROR = "Too many failed attempts. Please wait 15 minutes or contact the RTS Admin.";

export type AuthResult = { ok: true; session: Session; token: string } | { ok: false; error: string };

function sign(id: string): string {
  return crypto.createHmac("sha256", sessionSecret()).update(id).digest("base64url");
}

export function tokenFor(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

export function sessionIdFromToken(token: string | undefined): string | null {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const id = token.slice(0, dot);
  const mac = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(sign(id));
  if (mac.length !== expected.length || !crypto.timingSafeEqual(mac, expected)) return null;
  return id;
}

async function createSession(role: Session["role"], faculty: Faculty | null): Promise<Session> {
  const now = new Date();
  const ttl = env().SESSION_TTL_MINUTES * 60_000;
  return db().transact(async (tx) => {
    // Opportunistic cleanup of expired sessions.
    for (const old of await tx.list<Session>(C.sessions, (s) => Date.parse(s.expiresAt) < now.getTime())) tx.delete(C.sessions, old.id);
    const session = await tx.create<Session>(C.sessions, {
      id: newId("ses") + crypto.randomBytes(8).toString("hex"),
      role,
      facultyId: faculty?.id ?? null,
      accessGeneration: faculty?.access.generation ?? null,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
      revoked: false,
    });
    const actor: Actor = role === "ADMIN" ? { role: "ADMIN", ref: env().ADMIN_LOGIN_USERNAME } : { role: "FACULTY", ref: faculty?.id ?? "" };
    await audit(tx, actor, { action: "LOGIN", entityType: "session", entityId: session.id });
    return session;
  });
}

export async function loginAdmin(username: string, password: string, ip: string): Promise<AuthResult> {
  const keys = [`ip:${ip}`, "admin"];
  if (isLocked(keys)) return { ok: false, error: LOCKED_ERROR };
  const e = env();
  const hash = e.ADMIN_LOGIN_PASSWORD_HASH;
  const userOk = crypto.timingSafeEqual(
    crypto.createHash("sha256").update(username.trim()).digest(),
    crypto.createHash("sha256").update(e.ADMIN_LOGIN_USERNAME).digest(),
  );
  const passOk = hash ? await bcrypt.compare(password, hash) : false;
  if (!userOk || !passOk) {
    recordFailure(keys);
    return { ok: false, error: hash ? "Sign-in failed. Check your username and password." : "Admin login is not configured (ADMIN_LOGIN_PASSWORD_HASH)." };
  }
  recordSuccess(keys);
  const session = await createSession("ADMIN", null);
  return { ok: true, session, token: tokenFor(session.id) };
}

export async function loginFaculty(facultyId: string, code: string, ip: string): Promise<AuthResult> {
  const keys = [`ip:${ip}`, `fac:${facultyId}`];
  if (isLocked(keys)) return { ok: false, error: LOCKED_ERROR };
  const faculty = /^[A-Za-z0-9_.-]{1,120}$/.test(facultyId) ? await db().get<Faculty>(C.faculty, facultyId) : null;
  const usable = faculty && faculty.active && faculty.access.status === "ACTIVE";
  const ok = await verifySecret(normalizeAccessCode(code), usable ? faculty.access.secretHash : null);
  if (!ok || !faculty) {
    recordFailure(keys);
    return { ok: false, error: GENERIC_LOGIN_ERROR };
  }
  recordSuccess(keys);
  const session = await createSession("FACULTY", faculty);
  return { ok: true, session, token: tokenFor(session.id) };
}

/** Resolves a cookie token into a live session, enforcing expiry, revocation and access generation. */
export async function resolveSession(token: string | undefined): Promise<{ session: Session; faculty: Faculty | null } | null> {
  const id = sessionIdFromToken(token);
  if (!id) return null;
  const session = await db().get<Session>(C.sessions, id);
  if (!session || session.revoked || Date.parse(session.expiresAt) < Date.now()) return null;
  if (session.role === "ADMIN") return { session, faculty: null };
  if (!session.facultyId) return null;
  const faculty = await db().get<Faculty>(C.faculty, session.facultyId);
  // A regenerated or revoked access code invalidates every existing session.
  if (!faculty || !faculty.active || faculty.access.status !== "ACTIVE" || faculty.access.generation !== session.accessGeneration) return null;
  return { session, faculty };
}

/**
 * Sliding expiry: once less than half of the TTL remains, push expiry out by a full TTL.
 * Returns the renewed session, or null when no renewal was needed.
 */
export async function extendSessionIfDue(session: Session, now = Date.now()): Promise<Session | null> {
  const ttl = env().SESSION_TTL_MINUTES * 60_000;
  if (Date.parse(session.expiresAt) - now > ttl / 2) return null;
  return db().transact(async (tx) => {
    const cur = await tx.get<Session>(C.sessions, session.id);
    if (!cur || cur.revoked) return null;
    return tx.update<Session>(C.sessions, { ...cur, expiresAt: new Date(now + ttl).toISOString() });
  });
}

export async function logout(token: string | undefined): Promise<void> {
  const id = sessionIdFromToken(token);
  if (!id) return;
  await db().transact(async (tx) => {
    const s = await tx.get<Session>(C.sessions, id);
    if (s && !s.revoked) await tx.update<Session>(C.sessions, { ...s, revoked: true });
  });
}
