"use client";

import { useRef, useState } from "react";
import { issueCodeAction, revokeCodeAction, saveFacultyAction } from "@/app/actions/admin";
import { useAction } from "@/components/useAction";
import { fmtDate, fmtDateTime, STATUS_LABEL } from "@/lib/format";

type Row = {
  id: string;
  rev: number;
  displayName: string;
  email: string;
  designationKey: string;
  designationLabel: string;
  facultyCategory: "STANDARD" | "JUNIOR";
  dateOfJoining: string | null;
  researchStatus: string;
  employeeId: string | null;
  dateOfExit: string | null;
  active: boolean;
  accessStatus: string;
  issuedAt: string | null;
};
type Opt = { key: string; label: string; facultyCategory?: string };

const blank = { displayName: "", email: "", designationKey: "", dateOfJoining: "", researchStatus: "RESEARCH_ACTIVE", employeeId: "", dateOfExit: "", active: true };

export function FacultyManager({ rows, designations, statuses }: { rows: Row[]; designations: Opt[]; statuses: Opt[] }) {
  const a = useAction();
  const formRef = useRef<HTMLDialogElement>(null);
  const codeRef = useRef<HTMLDialogElement>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form, setForm] = useState<{ displayName: string; email: string; designationKey: string; dateOfJoining: string; researchStatus: string; employeeId: string; dateOfExit: string; active: boolean }>(blank);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState<{ name: string; email: string; emailed: boolean; emailError: string | null; code: string | null } | null>(null);
  const [filter, setFilter] = useState("");

  const openNew = () => {
    setEditing(null);
    setForm(blank);
    setReason("");
    a.setError(null);
    formRef.current?.showModal();
  };
  const openEdit = (r: Row) => {
    setEditing(r);
    setForm({ displayName: r.displayName, email: r.email, designationKey: r.designationKey, dateOfJoining: r.dateOfJoining ?? "", researchStatus: r.researchStatus, employeeId: r.employeeId ?? "", dateOfExit: r.dateOfExit ?? "", active: r.active });
    setReason("");
    a.setError(null);
    formRef.current?.showModal();
  };
  const issue = (r: Row) => {
    const msg = r.accessStatus === "ACTIVE"
      ? `Regenerate the access code for ${r.displayName}? The current code stops working, any open session ends, and the new code is emailed to ${r.email}.`
      : `Issue an access code for ${r.displayName}? It will be emailed to ${r.email}.`;
    if (!window.confirm(msg)) return;
    a.exec(() => issueCodeAction(r.id), (d) => {
      setCode(d);
      codeRef.current?.showModal();
    });
  };
  const revoke = (r: Row) => {
    const why = window.prompt(`Reason for revoking access for ${r.displayName}:`);
    if (why) a.exec(() => revokeCodeAction(r.id, why));
  };
  const fe = a.fieldErrors;
  const shown = rows.filter((r) => r.displayName.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="stack">
      <div className="row-between">
        <input className="input" style={{ maxWidth: 280 }} placeholder="Filter by name…" aria-label="Filter by name" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn btn-primary" onClick={openNew}>+ Add faculty</button>
      </div>
      {a.error && !formRef.current?.open && <div className="alert alert-bad" role="alert">{a.error}</div>}
      {a.message && <div className="alert alert-ok" role="status">{a.message}</div>}
      <div className="card">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Designation</th><th>Category</th><th>Joined</th><th>Email</th><th>Access</th><th /></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={7} className="muted">No faculty records yet. Add each faculty member, then issue their personal access code.</td></tr>}
              {shown.map((r) => (
                <tr key={r.id} style={{ opacity: r.active ? 1 : 0.55 }}>
                  <td className="strong">{r.displayName}{!r.active && <span className="badge badge-neutral" style={{ marginLeft: 6 }}>inactive</span>}</td>
                  <td className="small">{r.designationLabel}</td>
                  <td className="small">{r.facultyCategory === "JUNIOR" ? "Junior" : "Standard"}</td>
                  <td className="small">{fmtDate(r.dateOfJoining)}</td>
                  <td className="small">{r.email}</td>
                  <td>
                    <span className={`badge ${r.accessStatus === "ACTIVE" ? "badge-ok" : r.accessStatus === "REVOKED" ? "badge-bad" : "badge-warn"}`}>{STATUS_LABEL[r.accessStatus]}</span>
                    {r.issuedAt && <div className="tiny muted">issued {fmtDateTime(r.issuedAt)}</div>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                      <button className="btn btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button className="btn btn-sm" disabled={!r.active || a.pending} onClick={() => issue(r)}>{r.accessStatus === "ACTIVE" ? "Regenerate code" : "Issue code"}</button>
                      {r.accessStatus === "ACTIVE" && <button className="btn btn-sm btn-danger" onClick={() => revoke(r)}>Revoke</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <dialog ref={formRef} className="modal" aria-labelledby="fac-title" style={{ width: "min(720px, calc(100vw - 32px))" }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            a.exec(() => saveFacultyAction(editing?.id ?? null, editing?.rev ?? null, form, reason), () => formRef.current?.close());
          }}
        >
          <div className="modal-head"><h2 id="fac-title">{editing ? `Edit ${editing.displayName}` : "Add faculty member"}</h2></div>
          <div className="modal-body stack">
            {a.error && <div className="alert alert-bad" role="alert">{a.error}</div>}
            <div className="form-grid">
              <div className="field span-2">
                <label htmlFor="f-name" className="req">Full name</label>
                <input id="f-name" className="input" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} aria-invalid={fe.displayName ? true : undefined} />
                {fe.displayName && <span className="err">{fe.displayName}</span>}
              </div>
              <div className="field span-2">
                <label htmlFor="f-email" className="req">Email address</label>
                <input id="f-email" type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-invalid={fe.email ? true : undefined} />
                {fe.email && <span className="err">{fe.email}</span>}
                <span className="hint">PDFs are sent here. Faculty cannot change it themselves.</span>
              </div>
              <div className="field">
                <label htmlFor="f-des" className="req">Designation</label>
                <select
                  id="f-des"
                  className="input"
                  value={form.designationKey}
                  onChange={(e) => {
                    setForm({ ...form, designationKey: e.target.value });
                  }}
                  aria-invalid={fe.designationKey ? true : undefined}
                >
                  <option value="">— Select —</option>
                  {designations.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
                </select>
                {fe.designationKey && <span className="err">{fe.designationKey}</span>}
              </div>
              <div className="field">
                <span className="label">Faculty category</span>
                <span className="small" aria-live="polite">{form.designationKey ? (designations.find((x) => x.key === form.designationKey)?.facultyCategory === "JUNIOR" ? "Junior Faculty (minimum 30)" : "Standard (minimum 200)") : "—"}</span>
                <span className="hint">Set by the designation: Junior Faculty and Librarian are Junior; all others Standard.</span>
              </div>
              <div className="field">
                <label htmlFor="f-doj">Date of joining</label>
                <input id="f-doj" type="date" className="input" value={form.dateOfJoining} onChange={(e) => setForm({ ...form, dateOfJoining: e.target.value })} />
                <span className="hint">Used for prorating the minimum for faculty who join during the year.</span>
              </div>
              <div className="field">
                <label htmlFor="f-rs">Research status</label>
                <select id="f-rs" className="input" value={form.researchStatus} onChange={(e) => setForm({ ...form, researchStatus: e.target.value })}>
                  {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="f-emp">Employee ID (optional)</label>
                <input id="f-emp" className="input" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} />
              </div>
              <div className="field">
                <label htmlFor="f-doe">Date of exit (if leaving)</label>
                <input id="f-doe" type="date" className="input" value={form.dateOfExit} aria-invalid={fe.dateOfExit ? true : undefined} onChange={(e) => setForm({ ...form, dateOfExit: e.target.value })} />
                <span className="hint">Last working day. Prorates the minimum for faculty leaving during the year.</span>
                {fe.dateOfExit && <span className="err">{fe.dateOfExit}</span>}
              </div>
              <div className="field" style={{ justifyContent: "flex-end" }}>
                <label className="check"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active</label>
              </div>
              {editing && (
                <div className="field span-all">
                  <label htmlFor="f-reason" className="req">Reason for change</label>
                  <input id="f-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={fe.reason ? true : undefined} />
                  {fe.reason && <span className="err">{fe.reason}</span>}
                </div>
              )}
            </div>
          </div>
          <div className="modal-foot">
            <button type="button" className="btn" onClick={() => formRef.current?.close()}>Cancel</button>
            <button className="btn btn-primary" disabled={a.pending}>{a.pending ? "Saving…" : "Save"}</button>
          </div>
        </form>
      </dialog>

      <dialog ref={codeRef} className="modal" aria-labelledby="code-title" onClose={() => setCode(null)}>
        <div className="modal-head"><h2 id="code-title">Access code for {code?.name}</h2></div>
        {code?.emailed ? (
          <>
            <div className="modal-body stack">
              <div className="alert alert-ok" role="status">The new access code was emailed to <strong>{code.email}</strong>. It is not shown here; only a hash is stored.</div>
              <p className="small muted">Delivery status appears under Email issues if the message fails or bounces. If the faculty member does not receive it, regenerate the code (the email address can be corrected in the faculty record first).</p>
            </div>
            <div className="modal-foot"><button className="btn btn-primary" onClick={() => codeRef.current?.close()}>Done</button></div>
          </>
        ) : (
          <>
            <div className="modal-body stack">
              <div className="alert alert-bad" role="alert">The email to {code?.email} could not be sent{code?.emailError ? ` (${code.emailError})` : ""}. The code is active.</div>
              <div className="alert alert-warn">As a fallback the code is shown <strong>only once</strong>. Give it to the faculty member individually (not by group email), or regenerate later to email a new one.</div>
              <div className="secret" aria-label="Access code">{code?.code}</div>
              <button className="btn" onClick={() => code?.code && navigator.clipboard?.writeText(code.code)}>Copy to clipboard</button>
            </div>
            <div className="modal-foot"><button className="btn btn-primary" onClick={() => codeRef.current?.close()}>I have recorded the code</button></div>
          </>
        )}
      </dialog>
    </div>
  );
}
