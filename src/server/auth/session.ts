import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "../env";
import type { Actor } from "../audit";
import type { Faculty, Session } from "../domain/schemas";
import { extendSessionIfDue, resolveSession } from "./core";

type Role = Session["role"];

/**
 * One cookie per role. A single shared cookie meant that signing in as Faculty in another tab
 * silently replaced the Admin session (and vice versa), so the next Admin action on an already
 * open review page failed with "session expired". Separate cookies let both roles coexist.
 */
export const COOKIES: Record<Role, string> = { ADMIN: "rts_admin_session", FACULTY: "rts_faculty_session" };
const LEGACY_COOKIE = "rts_session";

export async function setSessionCookie(role: Role, token: string, expiresAt: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIES[role], token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env().NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
  if (jar.get(LEGACY_COOKIE)) jar.delete(LEGACY_COOKIE);
}

export async function clearSessionCookie(role: Role): Promise<void> {
  (await cookies()).delete(COOKIES[role]);
}

export async function currentToken(role: Role): Promise<string | undefined> {
  return (await cookies()).get(COOKIES[role])?.value;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

/** The live session for one role, or null. A token is only honoured for the role it was issued for. */
export async function getAuthFor(role: Role): Promise<{ session: Session; faculty: Faculty | null } | null> {
  const a = await resolveSession(await currentToken(role));
  return a && a.session.role === role ? a : null;
}

/** Any live session (Admin preferred), for role-neutral routes such as "/" and PDF downloads. */
export async function getAuth(): Promise<{ session: Session; faculty: Faculty | null } | null> {
  return (await getAuthFor("ADMIN")) ?? (await getAuthFor("FACULTY"));
}

export type AdminCtx = { session: Session; actor: Actor };
export type FacultyCtx = { session: Session; faculty: Faculty; actor: Actor };

/** For pages: redirects to login. For actions: use adminAction. */
export async function requireAdmin(): Promise<AdminCtx> {
  const a = await getAuthFor("ADMIN");
  if (!a) redirect("/login?role=admin");
  return { session: a.session, actor: { role: "ADMIN", ref: env().ADMIN_LOGIN_USERNAME } };
}

export async function requireFaculty(): Promise<FacultyCtx> {
  const a = await getAuthFor("FACULTY");
  if (!a || !a.faculty) redirect("/login");
  return { session: a.session, faculty: a.faculty, actor: { role: "FACULTY", ref: a.faculty.id } };
}

export class AuthError extends Error {
  constructor(role: Role) {
    super(
      role === "ADMIN"
        ? "Your Admin session has expired or you have signed out. Sign in again as Admin (your unsaved entry is still on screen)."
        : "Your session has expired or you have signed out. Please sign in again.",
    );
    this.name = "AuthError";
  }
}

/** Sliding expiry: active users are not signed out mid-review. Only possible where cookies are writable (actions). */
async function keepAlive(role: Role, session: Session): Promise<void> {
  const renewed = await extendSessionIfDue(session);
  if (renewed) await setSessionCookie(role, (await currentToken(role)) ?? "", renewed.expiresAt);
}

/** For server actions: throws instead of redirecting so the client can show a message. */
export async function adminAction(): Promise<AdminCtx> {
  const a = await getAuthFor("ADMIN");
  if (!a) throw new AuthError("ADMIN");
  await keepAlive("ADMIN", a.session);
  return { session: a.session, actor: { role: "ADMIN", ref: env().ADMIN_LOGIN_USERNAME } };
}

export async function facultyAction(): Promise<FacultyCtx> {
  const a = await getAuthFor("FACULTY");
  if (!a || !a.faculty) throw new AuthError("FACULTY");
  await keepAlive("FACULTY", a.session);
  return { session: a.session, faculty: a.faculty, actor: { role: "FACULTY", ref: a.faculty.id } };
}
