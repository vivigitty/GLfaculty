import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { NavLinks } from "./NavLinks";

export function Shell({ who, role, links, children }: { who: string; role: string; links: { href: string; label: string }[]; children: React.ReactNode }) {
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href={role === "Admin" ? "/admin" : "/faculty"} className="brand">
            <span className="brand-mark" aria-hidden>
              RTS
            </span>
            <span>
              RTS Portal
              <small>Research · Teaching · Service</small>
            </span>
          </Link>
          <NavLinks links={links} />
          <div className="userbox">
            <span>
              {who} <span style={{ opacity: 0.7 }}>· {role}</span>
            </span>
            <form action={logoutAction.bind(null, role === "Admin" ? "ADMIN" : "FACULTY")}>
              <button type="submit">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="page">{children}</main>
    </>
  );
}
