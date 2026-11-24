import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "../env";
import type { Actor } from "../audit";
import type { Faculty, Session } from "../domain/schemas";
import { resolveSession } from "./core";

export const COOKIE = "rts_session";

export async function setSessionCookie(token: string, expiresAt: string): Promise<void> {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: env().NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

export async function currentToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function getAuth(): Promise<{ session: Session; faculty: Faculty | null } | null> {
  return resolveSession(await currentToken());
}

export type AdminCtx = { session: Session; actor: Actor };
export type FacultyCtx = { session: Session; faculty: Faculty; actor: Actor };

/** For pages: redirects to login. For actions: use requireAdminAction. */
export async function requireAdmin(): Promise<AdminCtx> {
  const a = await getAuth();
  if (!a || a.session.role !== "ADMIN") redirect("/login?role=admin");
  return { session: a.session, actor: { role: "ADMIN", ref: env().ADMIN_LOGIN_USERNAME } };
}

export async function requireFaculty(): Promise<FacultyCtx> {
  const a = await getAuth();
  if (!a || a.session.role !== "FACULTY" || !a.faculty) redirect("/login");
  return { session: a.session, faculty: a.faculty, actor: { role: "FACULTY", ref: a.faculty.id } };
}

export class AuthError extends Error {
  constructor() {
    super("Your session has expired or you are not allowed to do this. Please sign in again.");
    this.name = "AuthError";
  }
}

/** For server actions: throws instead of redirecting so the client can show a message. */
export async function adminAction(): Promise<AdminCtx> {
  const a = await getAuth();
  if (!a || a.session.role !== "ADMIN") throw new AuthError();
  return { session: a.session, actor: { role: "ADMIN", ref: env().ADMIN_LOGIN_USERNAME } };
}

export async function facultyAction(): Promise<FacultyCtx> {
  const a = await getAuth();
  if (!a || a.session.role !== "FACULTY" || !a.faculty) throw new AuthError();
  return { session: a.session, faculty: a.faculty, actor: { role: "FACULTY", ref: a.faculty.id } };
}
