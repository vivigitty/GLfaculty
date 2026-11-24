import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { listYears } from "@/server/services/academicYears";
import { consolidated } from "@/server/services/payments";
import { C, db } from "@/server/db";
import type { Payment } from "@/server/domain/schemas";
import { Card, Empty, PageHeader, StatusBadge } from "@/components/ui";
import { fmtDate, fmtINR, fmtPoints } from "@/lib/format";
import { PaymentEditor } from "./PaymentEditor";

export const metadata = { title: "Consolidated & payments" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ ay?: string; view?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const years = await listYears();
  const current = years.filter((y) => !y.historicalOnly);
  const ayId = sp.ay ?? current[0]?.id;
  if (!ayId) return <Empty>No academic year configured.</Empty>;
  const junior = sp.view === "junior";
  const data = await consolidated(ayId, junior ? "JUNIOR" : "STANDARD");
  const payments = await db().list<Payment>(C.payments);
  const editableYears = [data.ay, ...data.historyYears].map((y) => ({ id: y.id, label: y.label }));
  const sum = (f: (r: (typeof data.rows)[number]) => string | null | undefined) => data.rows.reduce((a, r) => a + Number(f(r) ?? 0), 0);

  return (
    <div className="stack">
      <PageHeader
        title={junior ? "Junior Faculty — consolidated" : "Faculty — consolidated"}
        subtitle={`${data.ay.label}. Points come from submissions (approved values; under-review values are marked). Paid / Corrected are Finance entries.`}
        actions={
          <>
            <form className="row">
              <input type="hidden" name="view" value={junior ? "junior" : "faculty"} />
              <select name="ay" className="input" defaultValue={ayId} aria-label="Academic year" style={{ width: 160 }}>
                {current.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
              </select>
              <button className="btn btn-sm">Go</button>
            </form>
            <a className="btn btn-primary" href={`/api/admin/consolidated?ay=${ayId}&view=${junior ? "junior" : "faculty"}`}>Export CSV</a>
          </>
        }
      />
      <div className="seg" style={{ maxWidth: 360 }}>
        <Link href={`/admin/payments?ay=${ayId}`} aria-current={!junior ? "page" : undefined}>Faculty</Link>
        <Link href={`/admin/payments?ay=${ayId}&view=junior`} aria-current={junior ? "page" : undefined}>Junior Faculty</Link>
      </div>
      <Card flush>
        {data.rows.length === 0 ? (
          <div className="card-body"><Empty>No {junior ? "Junior Faculty" : "faculty"} records.</Empty></div>
        ) : (
          <div className="table-wrap">
            <table className="table table-compact" style={{ minWidth: 1300 }}>
              <thead>
                <tr>
                  <th>#</th><th>Name</th><th>Designation</th>
                  {!junior && <><th>Joined</th><th className="num">Exp. (yrs)</th></>}
                  <th className="num">Rate / pt</th>
                  <th className="num">R</th><th className="num">T</th><th className="num">S</th><th className="num">Earned</th><th className="num">Min.</th><th className="num">Payable</th>
                  <th className="num">Expected ₹</th><th>Points</th>
                  <th className="num">Paid</th><th className="num">Corrected</th><th className="num">Differential</th>
                  {data.historyYears.map((y) => <th key={y.id} className="num">{y.label}</th>)}
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const cur: Record<string, { rev: number; paidAmount: string; correctedAmount: string; fpmCount: string; fpmRate: string; paymentReference: string; notes: string; imported: boolean } | null> = {};
                  for (const y of editableYears) {
                    const p = payments.find((x) => x.facultyId === r.faculty.id && x.academicYearId === y.id);
                    cur[y.id] = p ? { rev: p._rev, paidAmount: p.paidAmount ?? "", correctedAmount: p.correctedAmount ?? "", fpmCount: p.fpmCount ?? "", fpmRate: p.fpmRate ?? "", paymentReference: p.paymentReference, notes: p.notes, imported: p.imported } : null;
                  }
                  return (
                    <tr key={r.faculty.id}>
                      <td>{r.serial}</td>
                      <td className="strong">{r.submission && r.submission.status !== "DRAFT" ? <Link href={`/admin/submissions/${r.submission.id}`}>{r.faculty.displayName}</Link> : r.faculty.displayName}</td>
                      <td className="small">{r.designationLabel}</td>
                      {!junior && <><td className="small">{fmtDate(r.faculty.dateOfJoining)}</td><td className="num">{r.experienceYears ?? "Nil"}</td></>}
                      <td className="num">{fmtINR(r.designationRate)}</td>
                      <td className="num">{fmtPoints(r.points?.R)}</td>
                      <td className="num">{fmtPoints(r.points?.T)}</td>
                      <td className="num">{fmtPoints(r.points?.S)}</td>
                      <td className="num strong">{fmtPoints(r.earned)}</td>
                      <td className="num">{fmtPoints(r.minimum)}</td>
                      <td className="num strong">{fmtPoints(r.pointsPayable)}</td>
                      <td className="num">{fmtINR(r.expectedPayment)}</td>
                      <td>{r.pointsSource === "NOT_SUBMITTED" ? <span className="muted small">not submitted</span> : <StatusBadge status={r.submission?.status ?? ""} />}</td>
                      <td className="num">{fmtINR(r.payment?.paidAmount)}</td>
                      <td className="num">{fmtINR(r.payment?.correctedAmount)}</td>
                      <td className="num strong">{fmtINR(r.differential)}</td>
                      {data.historyYears.map((y) => <td key={y.id} className="num">{fmtINR(r.history[y.id])}</td>)}
                      <td><PaymentEditor facultyId={r.faculty.id} facultyName={r.faculty.displayName} years={editableYears} current={cur} /></td>
                    </tr>
                  );
                })}
                <tr className="total">
                  <td colSpan={junior ? 4 : 6}>Total</td>
                  <td className="num">{fmtPoints(sum((r) => r.points?.R))}</td>
                  <td className="num">{fmtPoints(sum((r) => r.points?.T))}</td>
                  <td className="num">{fmtPoints(sum((r) => r.points?.S))}</td>
                  <td className="num">{fmtPoints(sum((r) => r.earned))}</td>
                  <td />
                  <td className="num">{fmtPoints(sum((r) => r.pointsPayable))}</td>
                  <td className="num">{fmtINR(sum((r) => r.expectedPayment))}</td>
                  <td />
                  <td className="num">{fmtINR(sum((r) => r.payment?.paidAmount))}</td>
                  <td className="num">{fmtINR(sum((r) => r.payment?.correctedAmount))}</td>
                  <td className="num">{fmtINR(sum((r) => r.differential))}</td>
                  {data.historyYears.map((y) => <td key={y.id} className="num">{fmtINR(sum((r) => r.history[y.id]))}</td>)}
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="small muted">Expected payment uses the progressive formula on approved points (research rate for the first R points, designation rate thereafter). Historical columns show imported Paid/Corrected values and are never recalculated. Add earlier years as “historical” in Academic years to record them.</p>
    </div>
  );
}
