"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { answerNotReceivedAction, confirmReceiptAction } from "@/app/actions/faculty";
import { fmtDateTime } from "@/lib/format";

type ReceiptInfo = { id: string; response: "YES_RECEIVED" | "NO_NOT_RECEIVED"; followUp: string; confirmedAt: string; addressShown: string } | null;

/** "Did you receive the file export by email?" — required post-send flow. */
export function ReceiptFlow({ submissionId, email, receipt, attemptLabel, correctionsEnabled }: { submissionId: string; email: string; receipt: ReceiptInfo; attemptLabel: string; correctionsEnabled: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"ask" | "wrong">("ask");
  const [newEmail, setNewEmail] = useState("");
  const [explanation, setExplanation] = useState("");
  const [notes, setNotes] = useState("");
  const [done, setDone] = useState<string | null>(null);

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, after?: string) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) setError(r.error ?? "Something went wrong.");
      else {
        if (after) setDone(after);
        router.refresh();
      }
    });

  if (done) return <div className="alert alert-ok" role="status">{done}</div>;

  if (!receipt) {
    return (
      <div className="stack">
        <p className="strong">Did you receive the file export by email?</p>
        <p className="small muted">{attemptLabel}</p>
        <div className="row">
          <button className="btn btn-success" disabled={pending} onClick={() => act(() => confirmReceiptAction(submissionId, true), "Thank you — receipt confirmed.")}>Yes, I received it</button>
          <button className="btn" disabled={pending} onClick={() => act(() => confirmReceiptAction(submissionId, false))}>No, I did not</button>
        </div>
        {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
      </div>
    );
  }

  if (receipt.response === "YES_RECEIVED") {
    return <div className="alert alert-ok">You confirmed receipt on {fmtDateTime(receipt.confirmedAt)} (sent to {receipt.addressShown}).</div>;
  }

  if (receipt.followUp === "CORRECTION_REQUESTED") {
    return <div className="alert alert-info">Your email address can only be changed by Admin. Your correction request has been sent for review. The Admin will resend your PDF once the address is updated.</div>;
  }
  if (receipt.followUp === "ADDRESS_CORRECT_NOT_RECEIVED") {
    return <div className="alert alert-info">The RTS Admin has been notified that the email did not arrive and will follow up. You can also download your PDF below if downloads are enabled.</div>;
  }

  // PENDING_ANSWER
  return (
    <div className="stack">
      <p>
        We sent the PDF to <strong>{email}</strong>. Is this your correct email address?
      </p>
      {mode === "ask" ? (
        <div className="stack">
          <div className="field">
            <label htmlFor="nr-notes">If the address is correct: please check your spam / junk folder first. Anything else the Admin should know? (optional)</label>
            <textarea id="nr-notes" className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={pending} onClick={() => act(() => answerNotReceivedAction(receipt.id, { addressCorrect: true, notes }), "Thanks. The RTS Admin has been notified and will follow up.")}>
              Address is correct — notify Admin
            </button>
            {correctionsEnabled && <button className="btn" onClick={() => setMode("wrong")}>The address is wrong</button>}
          </div>
        </div>
      ) : (
        <div className="stack">
          <div className="field">
            <label htmlFor="new-email" className="req">Correct email address</label>
            <input id="new-email" type="email" className="input" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="field">
            <label htmlFor="expl">Explanation (optional)</label>
            <textarea id="expl" className="input" rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
          </div>
          <div className="row">
            <button
              className="btn btn-primary"
              disabled={pending || !newEmail.trim()}
              onClick={() => act(() => answerNotReceivedAction(receipt.id, { addressCorrect: false, requestedEmail: newEmail, explanation }), "Your email address can only be changed by Admin. Your correction request has been sent for review.")}
            >
              Send correction request
            </button>
            <button className="btn btn-ghost" onClick={() => setMode("ask")}>Back</button>
          </div>
        </div>
      )}
      {error && <p className="small" role="alert" style={{ color: "var(--bad)" }}>{error}</p>}
    </div>
  );
}
