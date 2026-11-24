/** Display helpers shared by server and client. Calculations never happen here. */

const pts = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

export function fmtPoints(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "Nil";
  const n = Number(v);
  return Number.isFinite(n) ? pts.format(n) : String(v);
}

export function fmtINR(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "Nil";
  const n = Number(v);
  return Number.isFinite(n) ? inr.format(n) : String(v);
}

/** Plain-ASCII currency for PDFs (standard PDF fonts lack the ₹ glyph). */
export function fmtRs(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "Nil";
  const n = Number(v);
  return Number.isFinite(n) ? `Rs. ${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)}` : String(v);
}

export function fmtDate(v: string | null | undefined): string {
  if (!v) return "Nil";
  const d = new Date(v.length === 10 ? `${v}T00:00:00Z` : v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
}

export function fmtDateTime(v: string | null | undefined): string {
  if (!v) return "Nil";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

export function nil(v: string | null | undefined | boolean): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  if (v === null || v === undefined || String(v).trim() === "") return "Nil";
  return String(v);
}

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under review",
  NEEDS_CLARIFICATION: "Needs clarification",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  QUEUED: "Queued",
  SEND_ACCEPTED: "Accepted by provider",
  DELIVERED: "Delivered",
  BOUNCED: "Bounced",
  FAILED: "Failed",
  PENDING: "Pending",
  ACTIVE: "Active",
  REVOKED: "Revoked",
  PENDING_ISSUE: "No code issued",
  OPEN: "Open",
  CLOSED: "Closed",
  UPCOMING: "Upcoming",
};
