import { requireAdmin } from "@/server/auth/session";
import { C, db } from "@/server/db";
import type { AuditEvent } from "@/server/domain/schemas";
import { Card, PageHeader } from "@/components/ui";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Audit log" };

const LIMIT = 300;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  await requireAdmin();
  const { q, type } = await searchParams;
  const needle = q?.trim().toLowerCase();
  const all = await db().list<AuditEvent>(C.audit, (e) => (!type || e.entityType === type) && (!needle || `${e.action} ${e.entityId} ${e.actorRef} ${e.reason}`.toLowerCase().includes(needle)));
  const events = all.sort((a, b) => b.at.localeCompare(a.at)).slice(0, LIMIT);
  const types = ["submission", "faculty", "emailAttempt", "emailCorrection", "receipt", "payment", "academicYear", "export", "policy", "session"];
  return (
    <div className="stack">
      <PageHeader title="Audit log" subtitle={`Append-only record of consequential actions. Showing ${events.length} of ${all.length}.`} />
      <Card>
        <form className="row">
          <input name="q" className="input" style={{ maxWidth: 320 }} placeholder="Search action, id, reason…" defaultValue={q} aria-label="Search" />
          <select name="type" className="input" style={{ maxWidth: 200 }} defaultValue={type ?? ""} aria-label="Entity type">
            <option value="">All entities</option>
            {types.map((t) => <option key={t}>{t}</option>)}
          </select>
          <button className="btn btn-primary">Filter</button>
        </form>
      </Card>
      <Card flush>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Reason</th><th>Change</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="small muted" style={{ whiteSpace: "nowrap" }}>{fmtDateTime(e.at)}</td>
                  <td className="small">{e.actorRole}<div className="tiny muted mono">{e.actorRef}</div></td>
                  <td className="small strong">{e.action}</td>
                  <td className="small">{e.entityType}<div className="tiny muted mono">{e.entityId}</div></td>
                  <td className="small">{e.reason || "—"}</td>
                  <td className="tiny">
                    {(e.before !== undefined || e.after !== undefined) && (
                      <details>
                        <summary>view</summary>
                        <pre className="mono" style={{ whiteSpace: "pre-wrap", maxWidth: 420, fontSize: 11 }}>{JSON.stringify({ before: e.before, after: e.after }, null, 1)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
