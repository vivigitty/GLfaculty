"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { loginAdmin, loginFaculty, logout } from "@/server/auth/core";
import { clearSessionCookie, clientIp, currentToken, setSessionCookie } from "@/server/auth/session";

export type LoginState = { error?: string };

const facultyForm = z.object({ facultyId: z.string().min(1).max(120), code: z.string().min(1).max(100) });
const adminForm = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) });

export async function facultyLoginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const v = facultyForm.safeParse({ facultyId: form.get("facultyId"), code: form.get("code") });
  if (!v.success) return { error: "Select your name and enter your access code." };
  const res = await loginFaculty(v.data.facultyId, v.data.code, await clientIp());
  if (!res.ok) return { error: res.error };
  await setSessionCookie("FACULTY", res.token, res.session.expiresAt);
  redirect("/faculty");
}

export async function adminLoginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const v = adminForm.safeParse({ username: form.get("username"), password: form.get("password") });
  if (!v.success) return { error: "Enter your username and password." };
  const res = await loginAdmin(v.data.username, v.data.password, await clientIp());
  if (!res.ok) return { error: res.error };
  await setSessionCookie("ADMIN", res.token, res.session.expiresAt);
  redirect("/admin");
}

/** Signs out of one role only; a Faculty session open in the same browser is not affected (and vice versa). */
export async function logoutAction(role: "ADMIN" | "FACULTY"): Promise<void> {
  const r = role === "ADMIN" ? "ADMIN" : "FACULTY";
  await logout(await currentToken(r));
  await clearSessionCookie(r);
  redirect(r === "ADMIN" ? "/login?role=admin" : "/login");
}
