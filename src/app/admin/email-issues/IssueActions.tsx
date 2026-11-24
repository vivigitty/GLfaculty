"use client";

import { useState } from "react";
import { decideCorrectionAction, resendAction, resolveIssueAction } from "@/app/actions/admin";
import { useAction } from "@/components/useAction";

export function CorrectionDecision({ id }: { id: string }) {
  const a = useAction();
  const [reason, setReason] = useState("");
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input className="input" aria-label="Decision reason" placeholder="Reason, e.g. confirmed directly with faculty" value={reason} onChange={(e) => setReason(e.target.value)} />
      <div className="row">
        <button className="btn btn-success btn-sm" disabled={a.pending} onClick={() => a.exec(() => decideCorrectionAction(id, true, reason))}>Approve & update master</button>
        <button className="btn btn-danger btn-sm" disabled={a.pending} onClick={() => a.exec(() => decideCorrectionAction(id, false, reason))}>Reject</button>
      </div>
      {a.error && <span className="small" role="alert" style={{ color: "var(--bad)" }}>{a.error}</span>}
    </div>
  );
}

export function ResendButton({ submissionId, label = "Resend latest PDF" }: { submissionId: string; label?: string }) {
  const a = useAction();
  return (
    <span>
      <button className="btn btn-sm" disabled={a.pending} onClick={() => a.exec(() => resendAction(submissionId))}>{a.pending ? "Sending…" : label}</button>
      {a.error && <span className="small" role="alert" style={{ color: "var(--bad)" }}> {a.error}</span>}
      {a.message && <span className="small" style={{ color: "var(--ok)" }}> {a.message}</span>}
    </span>
  );
}

export function ResolveIssue({ id }: { id: string }) {
  const a = useAction();
  const [note, setNote] = useState("");
  return (
    <div className="row" style={{ gap: 6 }}>
      <input className="input" style={{ maxWidth: 260 }} aria-label="Resolution note" placeholder="Resolution note" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn btn-sm" disabled={a.pending} onClick={() => a.exec(() => resolveIssueAction(id, note))}>Mark resolved</button>
      {a.error && <span className="small" role="alert" style={{ color: "var(--bad)" }}>{a.error}</span>}
    </div>
  );
}
