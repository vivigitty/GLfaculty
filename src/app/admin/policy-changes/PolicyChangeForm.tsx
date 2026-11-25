"use client";

import { useState } from "react";
import Link from "next/link";
import { runPolicyChangeAction } from "@/app/actions/admin";
import { useAction } from "@/components/useAction";
import { StatusBadge } from "@/components/ui";
import { fmtPoints } from "@/lib/format";

type Pts = { R: string; T: string; S: string };
export type CandidateRow = { id: string; name: string; status: string; fromVersion: string; oldPoints: Pts; newPoints: Pts; oldTotal: string; newTotal: string; changedLines: number; validationIssues: number };
export type DraftRow = { id: string; name: string; oldTotal: string | null; newTotal: string; notified: boolean };

const rts = (p: Pts) => `${fmtPoints(p.R)} / ${fmtPoints(p.T)} / ${fmtPoints(p.S)}`;

export function PolicyChangeForm({ yearLabel, candidates, drafts }: { yearLabel: string; candidates: CandidateRow[]; drafts: DraftRow[] }) {
  const a = useAction();
  const pendingDrafts = drafts.filter((d) => !d.notified);
  const [subs, setSubs] = useState<Set<string>>(new Set(candidates.map((c) => c.id)));
  const [drs, setDrs] = useState<Set<string>>(new Set(pendingDrafts.map((d) => d.id)));
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<{ recomputed: number; notified: number; failures: string[] } | null>(null);
  const flip = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setter(n);
  };
  const approvedSelected = candidates.filter((c) => subs.has(c.id) && c.status === "APPROVED").length;
  const go = () => {
    const msg = `Recompute ${subs.size} submission(s) and email ${drs.size} draft holder(s) for ${yearLabel}?` + (approvedSelected ? `\n\n${approvedSelected} approved record(s) will be reopened for review and must be approved again.` : "");
    if (!window.confirm(msg)) return;
    a.exec(() => runPolicyChangeAction([...subs], [...drs], reason), (d) => setResult(d));
  };
  const allSubs = candidates.length > 0 && candidates.every((c) => subs.has(c.id));

  return (
    <div className="stack">
      {candidates.length > 0 && (
        <div className="table-wrap">
          <table className="table table-compact">
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all submissions" checked={allSubs} onChange={() => setSubs(allSubs ? new Set() : new Set(candidates.map((c) => c.id)))} /></th>
                <th>Faculty</th><th>Status</th><th>Scored under</th>
                <th className="num">Current R / T / S</th><th className="num">Total</th>
                <th className="num">Recomputed R / T / S</th><th className="num">Total</th><th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((c) => {
                const delta = Number(c.newTotal) - Number(c.oldTotal);
                return (
                  <tr key={c.id}>
                    <td><input type="checkbox" aria-label={`Recompute ${c.name}`} checked={subs.has(c.id)} onChange={() => flip(subs, setSubs, c.id)} /></td>
                    <td className="strong"><Link href={`/admin/submissions/${c.id}`}>{c.name}</Link></td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="small mono">{c.fromVersion}</td>
                    <td className="num small">{rts(c.oldPoints)}</td>
                    <td className="num">{fmtPoints(c.oldTotal)}</td>
                    <td className="num small">{rts(c.newPoints)}</td>
                    <td className="num strong" style={{ color: delta > 0 ? "var(--ok)" : delta < 0 ? "var(--bad)" : undefined }}>{fmtPoints(c.newTotal)}{delta !== 0 && <span className="tiny"> ({delta > 0 ? "+" : ""}{fmtPoints(delta)})</span>}</td>
                    <td className="tiny">
                      {c.changedLines} line(s) change
                      {c.status === "APPROVED" && <div style={{ color: "var(--warn)" }}>will be reopened</div>}
                      {c.validationIssues > 0 && <div style={{ color: "var(--warn)" }}>{c.validationIssues} field(s) fail new rules</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {drafts.length > 0 && (
        <div>
          <h3 className="small strong" style={{ margin: "4px 0" }}>Drafts (already moved to the new policy)</h3>
          <p className="tiny muted" style={{ marginTop: 0 }}>Draft points update automatically. Tick a draft to email its owner the before/after draft points (sent once per policy version).</p>
          <table className="table table-compact">
            <thead><tr><th /><th>Faculty</th><th className="num">Draft total before</th><th className="num">Draft total now</th><th /></tr></thead>
            <tbody>
              {drafts.map((d) => (
                <tr key={d.id}>
                  <td><input type="checkbox" aria-label={`Email ${d.name}`} disabled={d.notified} checked={drs.has(d.id)} onChange={() => flip(drs, setDrs, d.id)} /></td>
                  <td>{d.name}</td>
                  <td className="num">{fmtPoints(d.oldTotal)}</td>
                  <td className="num">{fmtPoints(d.newTotal)}</td>
                  <td className="tiny muted">{d.notified ? "already notified" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="field">
        <label htmlFor={`pc-reason-${yearLabel}`} className="req">Reason (recorded in the audit log and each version)</label>
        <input id={`pc-reason-${yearLabel}`} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Nov 2026 points revision approved by the Dean" aria-invalid={a.fieldErrors.reason ? true : undefined} />
        {a.fieldErrors.reason && <span className="err">{a.fieldErrors.reason}</span>}
      </div>
      <div className="row">
        <button className="btn btn-primary" disabled={a.pending || (subs.size === 0 && drs.size === 0)} onClick={go}>
          {a.pending ? "Working…" : `Recompute ${subs.size} & email faculty`}
        </button>
        <span className="tiny muted">Recomputed records then need line verification and approval as usual.</span>
      </div>
      {a.error && <div className="alert alert-bad" role="alert">{a.error}</div>}
      {result && (
        <div className={`alert ${result.failures.length ? "alert-warn" : "alert-ok"}`} role="status">
          Recomputed {result.recomputed} submission(s); emailed {result.notified} draft holder(s).
          {result.failures.length > 0 && <ul>{result.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
