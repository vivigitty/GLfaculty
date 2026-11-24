"use client";

import { useRef, useState } from "react";
import { savePaymentAction } from "@/app/actions/admin";
import { useAction } from "@/components/useAction";

type P = { paidAmount: string; correctedAmount: string; fpmCount: string; fpmRate: string; paymentReference: string; notes: string; imported: boolean };

export function PaymentEditor({ facultyId, facultyName, years, current }: { facultyId: string; facultyName: string; years: { id: string; label: string }[]; current: Record<string, (P & { rev: number }) | null> }) {
  const a = useAction();
  const ref = useRef<HTMLDialogElement>(null);
  const [ay, setAy] = useState(years[0]?.id ?? "");
  const empty: P = { paidAmount: "", correctedAmount: "", fpmCount: "", fpmRate: "", paymentReference: "", notes: "", imported: false };
  const [f, setF] = useState<P>(current[ay] ?? empty);
  const [reason, setReason] = useState("");
  const pick = (id: string) => {
    setAy(id);
    setF(current[id] ?? { ...empty, imported: id !== years[0]?.id });
  };
  const fe = a.fieldErrors;
  const input = (k: keyof P, label: string, hint?: string) => (
    <div className="field">
      <label htmlFor={`p-${k}`}>{label}</label>
      <input id={`p-${k}`} className="input input-num" inputMode="decimal" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-invalid={fe[k] ? true : undefined} />
      {fe[k] ? <span className="err">{fe[k]}</span> : hint && <span className="hint">{hint}</span>}
    </div>
  );
  return (
    <>
      <button className="btn btn-sm" onClick={() => { pick(years[0]?.id ?? ""); setReason(""); a.setError(null); ref.current?.showModal(); }}>Edit</button>
      <dialog ref={ref} className="modal" style={{ width: "min(640px, calc(100vw - 32px))" }}>
        <form onSubmit={(e) => { e.preventDefault(); a.exec(() => savePaymentAction(facultyId, ay, current[ay]?.rev ?? null, f, reason), () => ref.current?.close()); }}>
          <div className="modal-head"><h2>Payments — {facultyName}</h2></div>
          <div className="modal-body stack">
            {a.error && <div className="alert alert-bad" role="alert">{a.error}</div>}
            <div className="field">
              <label htmlFor="p-ay">Academic year</label>
              <select id="p-ay" className="input" value={ay} onChange={(e) => pick(e.target.value)}>
                {years.map((y) => <option key={y.id} value={y.id}>{y.label}</option>)}
              </select>
              <span className="hint">Each year is a separate record; editing one never changes another.</span>
            </div>
            <div className="form-grid">
              {input("paidAmount", "Paid (₹)")}
              {input("correctedAmount", "Corrected (₹)", "Differential = Corrected − Paid")}
              {input("fpmCount", "FPM count (workbook column)")}
              {input("fpmRate", "FPM rate (₹)")}
              <div className="field span-2">
                <label htmlFor="p-ref">Payment reference</label>
                <input id="p-ref" className="input" value={f.paymentReference} onChange={(e) => setF({ ...f, paymentReference: e.target.value })} />
              </div>
              <div className="field span-all">
                <label htmlFor="p-notes">Notes</label>
                <textarea id="p-notes" className="input" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
              </div>
              <div className="field span-all">
                <label className="check"><input type="checkbox" checked={f.imported} onChange={(e) => setF({ ...f, imported: e.target.checked })} /> Imported historical value (reference only, not a system calculation)</label>
              </div>
              <div className="field span-all">
                <label htmlFor="p-reason" className="req">Reason / source</label>
                <input id="p-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Finance payout sheet June 2026" />
                {fe.reason && <span className="err">{fe.reason}</span>}
              </div>
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
