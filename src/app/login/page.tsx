import Link from "next/link";
import { redirect } from "next/navigation";
import { facultyLoginOptions } from "@/server/services/faculty";
import { getAuth } from "@/server/auth/session";
import { LoginForms } from "./LoginForms";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ role?: string }> }) {
  const auth = await getAuth();
  if (auth) redirect(auth.session.role === "ADMIN" ? "/admin" : "/faculty");
  const { role } = await searchParams;
  const isAdmin = role === "admin";
  const options = isAdmin ? [] : await facultyLoginOptions();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <span className="brand">
            <span className="brand-mark" aria-hidden>
              RTS
            </span>
            <span>
              RTS Portal<small>Research · Teaching · Service</small>
            </span>
          </span>
        </div>
      </header>
      <div className="login-wrap">
        <div className="card login-card">
          <div className="card-body stack">
            <div>
              <h1>Sign in</h1>
              <p className="muted small" style={{ marginTop: 4 }}>
                Annual RTS submission and review.
              </p>
            </div>
            <div className="seg" role="navigation" aria-label="Choose role">
              <Link href="/login" aria-current={!isAdmin ? "page" : undefined}>
                Faculty
              </Link>
              <Link href="/login?role=admin" aria-current={isAdmin ? "page" : undefined}>
                Admin
              </Link>
            </div>
            <LoginForms isAdmin={isAdmin} options={options} />
          </div>
        </div>
      </div>
    </>
  );
}
