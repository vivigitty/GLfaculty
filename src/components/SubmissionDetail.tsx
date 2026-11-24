import type { Policy } from "@/server/policy/schema";
import type { Submission } from "@/server/domain/schemas";
import { fmtDate, fmtINR, fmtPoints, nil } from "@/lib/format";
import { isHidden, optionLabel } from "@/lib/policyView";
import { StatusBadge } from "./ui";

/** Read-only rendering of every submitted field. Blank values show as "Nil". */
export function SubmissionDetail({ sub, policy, showReviews }: { sub: Submission; policy: Policy; showReviews?: boolean }) {
  const lines = new Map((sub.submittedScore?.lines ?? []).map((l) => [l.lineId, l]));
  const cols = policy.teaching.columns;
  const review = (id: string) => (showReviews ? sub.lineReviews[id] : undefined);
  const ti = sub.submittedScore?.teachingInfo;

  return (
    <div className="stack">
      <section className="card">
        <div className="card-head"><h2>Teaching</h2><span className="badge badge-brand">T {fmtPoints(sub.submittedPoints?.T ?? "0")}</span></div>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Course</th><th className="num">Sections</th><th className="num">Students</th><th className="num">Feedback</th>
                {cols.map((c) => <th key={c.key} className="num">{c.label}</th>)}
                <th className="num">Points</th>
              </tr>
            </thead>
            <tbody>
              {sub.content.teaching.length === 0 && <tr><td colSpan={cols.length + 5} className="muted">Nil</td></tr>}
              {sub.content.teaching.map((r) => (
                <tr key={r.id}>
                  <td>{nil(r.courseName)}</td>
                  <td className="num">{nil(r.sections)}</td>
                  <td className="num">{nil(r.students)}</td>
                  <td className="num">{nil(r.feedback)}</td>
                  {cols.map((c) => <td key={c.key} className="num">{nil(r.hours[c.key])}</td>)}
                  <td className="num strong">{fmtPoints(lines.get(`T:${r.id}`)?.points ?? "0")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {ti && (
          <div className="card-foot small muted">
            Total {fmtPoints(ti.totalHours)} h · CLD {fmtPoints(ti.cldHours)} h{ti.cldCompensation !== null && Number(ti.cldHours) > 0 ? ` (${fmtINR(ti.cldCompensation)} shown separately)` : ""} · towards cap {fmtPoints(ti.hoursCountedForCap)} / {fmtPoints(ti.capHours)} h · contractual load {fmtPoints(ti.contractualLoadHours)} h
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head"><h2>Research</h2><span className="badge badge-brand">R {fmtPoints(sub.submittedPoints?.R ?? "0")}</span></div>
        <div className="card-body stack">
          {policy.researchSections.map((s) => {
            const list = sub.content.research.filter((e) => e.sectionKey === s.key);
            return (
              <div key={s.key} className="section-block">
                <h3 style={{ marginBottom: 8 }}>{s.label} <span className="badge badge-neutral">{list.length}</span></h3>
                {list.length === 0 && <p className="muted small">Nil</p>}
                <div className="stack">
                  {list.map((e, i) => {
                    const ln = lines.get(`R:${e.id}`);
                    const rv = review(`R:${e.id}`);
                    return (
                      <div key={e.id} className="entry">
                        <div className="entry-head">
                          <span className="strong small">#{i + 1} {String(e.values.title ?? e.values.journal ?? e.values.student ?? "")}</span>
                          <span className="row">
                            {rv && <StatusBadge status={rv.status} />}
                            <span className={`badge ${ln?.reviewRequired ? "badge-warn" : "badge-ok"}`}>{fmtPoints(ln?.points ?? "0")} pts</span>
                            {rv?.approvedPoints != null && <span className="badge badge-brand">approved {fmtPoints(rv.approvedPoints)}</span>}
                          </span>
                        </div>
                        <div className="entry-body">
                          <dl className="kv small">
                            {s.fields.filter((f) => !isHidden(f, e.values)).map((f) => {
                              const v = e.values[f.key];
                              const shown = f.type === "select" ? optionLabel(policy, f, v) : f.type === "date" ? (v ? fmtDate(String(v)) : "") : f.type === "money" && v ? fmtINR(String(v)) : v;
                              return [<dt key={`${f.key}-k`}>{f.label}</dt>, <dd key={`${f.key}-v`} style={{ whiteSpace: "pre-wrap" }}>{nil(shown as string | boolean | null)}</dd>];
                            })}
                          </dl>
                          {ln && <p className="tiny muted" style={{ marginTop: 6 }}>{ln.explanation}</p>}
                          {rv?.note && <p className="small" style={{ marginTop: 6 }}><strong>Admin note:</strong> {rv.note}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Service</h2><span className="badge badge-brand">S {fmtPoints(sub.submittedPoints?.S ?? "0")}</span></div>
        <div className="table-wrap">
          <table className="table table-compact">
            <thead><tr><th>Responsibility</th><th className="num">Quantity</th><th>Details</th><th className="num">Points</th></tr></thead>
            <tbody>
              {policy.service.roles.map((r) => {
                const v = sub.content.service.roles[r.key];
                const ln = lines.get(`S:${r.key}`);
                return (
                  <tr key={r.key}>
                    <td>{r.label}</td>
                    <td className="num">{nil(v && Number(v.quantity) > 0 ? v.quantity : "")}</td>
                    <td>{nil(v?.description)}</td>
                    <td className="num">{ln ? fmtPoints(ln.points) : "Nil"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-body">
          <h3 style={{ marginBottom: 6 }}>Other service (not scored)</h3>
          <dl className="kv small">
            {policy.service.disclosures.map((d) => [<dt key={`${d.key}-k`}>{d.label}</dt>, <dd key={`${d.key}-v`} style={{ whiteSpace: "pre-wrap" }}>{nil(sub.content.service.disclosures[d.key])}</dd>])}
          </dl>
          <h3 style={{ margin: "14px 0 6px" }}>Faculty notes</h3>
          <p className="small" style={{ whiteSpace: "pre-wrap" }}>{nil(sub.content.facultyNotes)}</p>
        </div>
      </section>
    </div>
  );
}
