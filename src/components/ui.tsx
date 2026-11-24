import Link from "next/link";
import { STATUS_LABEL } from "@/lib/format";

/** Small presentational building blocks shared by every page. */

type Tone = "neutral" | "info" | "ok" | "warn" | "bad" | "brand";

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: "neutral",
  SUBMITTED: "info",
  UNDER_REVIEW: "brand",
  NEEDS_CLARIFICATION: "warn",
  APPROVED: "ok",
  REJECTED: "bad",
  QUEUED: "neutral",
  SEND_ACCEPTED: "info",
  DELIVERED: "ok",
  BOUNCED: "bad",
  FAILED: "bad",
  PENDING: "warn",
  ACTIVE: "ok",
  REVOKED: "bad",
  PENDING_ISSUE: "warn",
  OPEN: "ok",
  CLOSED: "neutral",
  UPCOMING: "info",
  VERIFIED: "ok",
  DISPUTED: "bad",
  NEEDS_EVIDENCE: "warn",
  UNVERIFIED: "neutral",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status.replace(/_/g, " ").toLowerCase()}</Badge>;
}

export function PageHeader({ title, subtitle, crumbs, actions }: { title: string; subtitle?: React.ReactNode; crumbs?: { href: string; label: string }[]; actions?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {crumbs && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={c.href}>
                <Link href={c.href}>{c.label}</Link>
                {i < crumbs.length - 1 ? " / " : ""}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Card({ title, subtitle, actions, children, footer, flush }: { title?: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; flush?: boolean }) {
  return (
    <section className="card">
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {flush ? children : <div className="card-body">{children}</div>}
      {footer && <div className="card-foot">{footer}</div>}
    </section>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "ok" | "warn" | "bad"; title?: string; children?: React.ReactNode }) {
  return (
    <div className={`alert alert-${tone}`} role={tone === "bad" ? "alert" : "status"}>
      <div>
        {title && <div className="strong">{title}</div>}
        {children}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Stat({ label, value, sub, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string }) {
  const inner = (
    <>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="card stat" style={{ display: "block", color: "inherit" }}>
      {inner}
    </Link>
  ) : (
    <div className="card stat">{inner}</div>
  );
}
