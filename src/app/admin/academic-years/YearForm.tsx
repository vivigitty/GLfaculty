"use client";

import { useRef, useState } from "react";
import { saveYearAction } from "@/app/actions/admin";
import { useAction } from "@/components/useAction";

type Year = { id: string; rev: number; label: string; startDate: string; endDate: string; submissionOpenAt: string; submissionCloseAt: string; status: "UPCOMING" | "OPEN" | "CLOSED"; policyVersion: string; historicalOnly: boolean };

export function YearEditor({ year, policies, label }: { year: Year | null; policies: string[]; label: string }) {
  const a = useAction();
  const ref = useRef<HTMLDialogElement>(null);
  const init = year ?? { id: "", rev: 0, label: "", startDate: "", endDate: "", submissionOpenAt: "", submissionCloseAt: "", status: "UPCOMING" as const, policyVersion: policies[0] ?? "", historicalOnly: false };
  const [f, setF] = useState(init);
  const [reason, setReason] = useState("");
  const fe = a.fieldErrors;
  const field = (k: keyof Year, lbl: string, type = "text", disabled = false) => (
    <div className="field">
      <label htmlFor={`y-${k}-${init.id}`}>{lbl}</label>
      <input id={`y-${k}-${init.id}`} type={type} className="input" disabled={disabled} value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-invalid={fe[k] ? true : undefined} />
      {fe[k] && <span className="err">{fe[k]}</span>}
    </div>
  );
  return (
    <>
      <button className={year ? "btn btn-sm" : "btn btn-primary"} onClick={() => { setF(init); a.setError(null); ref.current?.showModal(); }}>{label}</button>
      <dialog ref={ref} className="modal" style={{ width: "min(680px, calc(100vw - 32px))" }}>
        <form onSubmit={(e) => { e.preventDefault(); const { rev, ...input } = f; a.exec(() => saveYearAction(input, year ? rev : null, reason), () => ref.current?.close()); }}>
          <div className="modal-head"><h2>{year ? `Edit ${year.label}` : "New academic year"}</h2></div>
          <div className="modal-body stack">
            {a.error && <div className="alert alert-bad" role="alert">{a.error}</div>}
            <div className="form-grid">
              {field("id", "Identifier (e.g. AY2026-27)", "text", Boolean(year))}
              {field("label", "Label (e.g. AY 2026-27)")}
              {field("startDate", "Reporting period start", "date")}
              {field("endDate", "Reporting period end", "date")}
              {field("submissionOpenAt", "Submissions open", "date")}
              {field("submissionCloseAt", "Submissions close", "date")}
              <div className="field">
                <label htmlFor={`y-status-${init.id}`}>Status</label>
                <select id={`y-status-${init.id}`} className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Year["status"] })}>
                  <option value="UPCOMING">Upcoming</option>
                  <option value="OPEN">Open</option>
                  <option value="CLOSED">Closed</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`y-pol-${init.id}`}>Policy version</label>
                <select id={`y-pol-${init.id}`} className="input" value={f.policyVersion} onChange={(e) => setF({ ...f, policyVersion: e.target.value })}>
                  {policies.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="field span-all">
                <label className="check"><input type="checkbox" checked={f.historicalOnly} onChange={(e) => setF({ ...f, historicalOnly: e.target.checked })} /> Historical year (payment history only, no submissions)</label>
              </div>
              {year && (
                <div className="field span-all">
                  <label htmlFor={`y-reason-${init.id}`} className="req">Reason for change</label>
                  <input id={`y-reason-${init.id}`} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
                  {fe.reason && <span className="err">{fe.reason}</span>}
                </div>
              )}
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={() => ref.current?.close()}>Cancel</button>
            <button className="btn btn-primary" disabled={a.pending}>Save</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
