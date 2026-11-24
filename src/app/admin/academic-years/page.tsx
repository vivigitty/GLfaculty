import { requireAdmin } from "@/server/auth/session";
import { isAcceptingSubmissions, listYears } from "@/server/services/academicYears";
import { listPolicies } from "@/server/policy/load";
import { Card, PageHeader, StatusBadge } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { YearEditor } from "./YearForm";

export const metadata = { title: "Academic years" };

export default async function YearsPage() {
  await requireAdmin();
  const [years, policies] = await Promise.all([listYears(), listPolicies()]);
  const versions = policies.map((p) => p.id);
  return (
    <div className="stack">
      <PageHeader title="Academic years" subtitle="Reporting periods, submission windows and the policy version each year uses." actions={<YearEditor year={null} policies={versions} label="+ New academic year" />} />
      <Card flush>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Year</th><th>Reporting period</th><th>Submission window</th><th>Status</th><th>Policy</th><th /></tr></thead>
            <tbody>
              {years.map((y) => (
                <tr key={y.id}>
                  <td className="strong">{y.label} {y.historicalOnly && <span className="badge badge-neutral">history</span>}</td>
                  <td className="small">{fmtDate(y.startDate)} – {fmtDate(y.endDate)}</td>
                  <td className="small">{fmtDate(y.submissionOpenAt)} – {fmtDate(y.submissionCloseAt)} {isAcceptingSubmissions(y) && <span className="badge badge-ok">accepting now</span>}</td>
                  <td><StatusBadge status={y.status} /></td>
                  <td className="mono">{y.policyVersion}</td>
                  <td><YearEditor year={{ ...y, rev: y._rev }} policies={versions} label="Edit" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="small muted">Faculty can submit only when a year is “Open” and today is within its submission window. Historical years hold imported payment history for the consolidated sheets.</p>
    </div>
  );
}
