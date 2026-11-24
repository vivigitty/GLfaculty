"use client";

import { useState } from "react";
import { adjustCategoryAction, exportAndEmailAction, lineReviewAction, reviewAction } from "@/app/actions/admin";
import { useAction } from "@/components/useAction";
import type { RTS, ScoreLine } from "@/server/domain/schemas";
import { fmtPoints } from "@/lib/format";

type LineReview = { status: string; note: string; approvedPoints: string | null; reason: string } | undefined;

function Feedback({ a }: { a: ReturnType<typeof useAction> }) {
  if (a.error) return <p className="small" role="alert" style={{ color: "var(--bad)" }}>{a.error}</p>;
  if (a.message) return <p className="small" role="status" style={{ color: "var(--ok)" }}>{a.message}</p>;
  return null;
}

/** Independent adjustment of approved R, T and S (each with a mandatory reason). */
export function CategoryAdjust({ submissionId, rev, submitted, approved, remarks, editable }: { submissionId: string; rev: number; submitted: RTS; approved: RTS; remarks: Partial<Record<"R" | "T" | "S", string>>; editable: boolean }) {
  const a = useAction();
  const [cat, setCat] = useState<"R" | "T" | "S" | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const labels = { R: "Research", T: "Teaching", S: "Service" } as const;
  return (
    <div className="stack">
      <div className="points-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {(["R", "T", "S"] as const).map((k) => (
          <div key={k} className="point-tile">
            <div className="k">{labels[k]} ({k})</div>
            <div className="v">{fmtPoints(approved[k])}</div>
            <div className="tiny muted">submitted {fmtPoints(submitted[k])}</div>
            {remarks[k] && <div className="tiny"><strong>Remark:</strong> {remarks[k]}</div>}
            {editable && (
              <button className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => { setCat(k); setValue(approved[k]); setReason(remarks[k] ?? ""); a.setError(null); }}>
                {remarks[k] ? `Adjust ${k} / edit remark` : `Adjust approved ${k} / add remark`}
              </button>
            )}
          </div>
        ))}
      </div>
      {cat && editable && (
        <div className="entry">
          <div className="entry-body stack">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="adj-val">Approved {labels[cat]} points</label>
                <input id="adj-val" className="input input-num" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
                <span className="hint">Submitted: {fmtPoints(submitted[cat])}. Only {cat} changes.</span>
              </div>
              <div className="field span-2">
                <label htmlFor="adj-reason" className="req">Remark (shown on the faculty&apos;s final PDF)</label>
                <input id="adj-reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={a.fieldErrors.reason ? true : undefined} />
                {a.fieldErrors.reason && <span className="err">{a.fieldErrors.reason}</span>}
              </div>
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={a.pending} onClick={() => a.exec(() => adjustCategoryAction(submissionId, rev, cat, value, reason), () => setCat(null))}>Save {cat}</button>
              <button className="btn btn-ghost" onClick={() => setCat(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      <Feedback a={a} />
    </div>
  );
}

/** Per-line verification and optional approved-points override. */
export function LineReviewRow({ submissionId, rev, line, review, editable }: { submissionId: string; rev: number; line: ScoreLine; review: LineReview; editable: boolean }) {
  const a = useAction();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState(review?.status ?? "UNVERIFIED");
  const [note, setNote] = useState(review?.note ?? "");
  const [pts, setPts] = useState(review?.approvedPoints ?? "");
  const [reason, setReason] = useState("");
  const approved = review?.approvedPoints ?? line.points;
  const tone = { VERIFIED: "badge-ok", DISPUTED: "badge-bad", NEEDS_EVIDENCE: "badge-warn" }[review?.status ?? ""] ?? "badge-neutral";
  return (
    <>
      <tr>
        <td><span className="badge badge-brand">{line.category}</span></td>
        <td>
          <div className="strong small">{line.detail}</div>
          <div className="tiny muted">{line.label} · {line.explanation}</div>
          {review?.note && <div className="tiny"><strong>Note:</strong> {review.note}</div>}
        </td>
        <td>{line.reviewRequired && <span className="badge badge-warn">Review</span>}</td>
        <td className="num">{fmtPoints(line.points)}</td>
        <td className="num strong" style={{ color: approved !== line.points ? "var(--brand)" : undefined }}>{fmtPoints(approved)}</td>
        <td><span className={`badge ${tone}`}>{(review?.status ?? "UNVERIFIED").replace(/_/g, " ").toLowerCase()}</span></td>
        <td>{editable && <button className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close" : "Review"}</button>}</td>
      </tr>
      {open && editable && (
        <tr>
          <td colSpan={7} style={{ background: "var(--surface-2)" }}>
            <div className="form-grid">
              <div className="field">
                <label htmlFor={`st-${line.lineId}`}>Verification</label>
                <select id={`st-${line.lineId}`} className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option value="UNVERIFIED">Unverified</option>
                  <option value="VERIFIED">Verified</option>
                  <option value="NEEDS_EVIDENCE">Needs evidence</option>
                  <option value="DISPUTED">Disputed</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor={`pt-${line.lineId}`}>Approved points (blank = as submitted)</label>
                <input id={`pt-${line.lineId}`} className="input input-num" inputMode="decimal" value={pts} placeholder={line.points} onChange={(e) => setPts(e.target.value)} />
              </div>
              <div className="field span-2">
                <label htmlFor={`nt-${line.lineId}`}>Admin note</label>
                <input id={`nt-${line.lineId}`} className="input" value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <div className="field span-all">
                <label htmlFor={`rs-${line.lineId}`}>Reason (required when approved points change)</label>
                <input id={`rs-${line.lineId}`} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
              </div>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn btn-primary btn-sm" disabled={a.pending} onClick={() => a.exec(() => lineReviewAction(submissionId, rev, line.lineId, { status, note, approvedPoints: pts.trim() === "" ? null : pts, reason }), () => setOpen(false))}>Save</button>
              <span className="tiny muted">Changing points recomputes approved {line.category} from its lines; other categories are unchanged.</span>
            </div>
            <Feedback a={a} />
          </td>
        </tr>
      )}
    </>
  );
}

/** Workflow transitions. */
export function DecisionPanel({ submissionId, rev, status }: { submissionId: string; rev: number; status: string }) {
  const a = useAction();
  const [msg, setMsg] = useState("");
  const reviewable = status === "SUBMITTED" || status === "UNDER_REVIEW";
  const decided = status === "APPROVED" || status === "REJECTED";
  const go = (op: Parameters<typeof reviewAction>[0], confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    a.exec(() => reviewAction(op, submissionId, rev, msg), () => setMsg(""));
  };
  return (
    <div className="stack">
      {status === "SUBMITTED" && <button className="btn btn-primary" disabled={a.pending} onClick={() => go("start")}>Start review</button>}
      <div className="field">
        <label htmlFor="decision-msg">Message / reason</label>
        <textarea id="decision-msg" className="input" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder={reviewable ? "Required for clarification or rejection; optional for approval" : decided ? "Required to reopen" : "Internal note"} />
      </div>
      {reviewable && (
        <div className="row">
          <button className="btn btn-success" disabled={a.pending} onClick={() => go("approve", "Approve and lock this submission? The final PDF will be generated and emailed.")}>Approve & lock</button>
          <button className="btn" disabled={a.pending} onClick={() => go("clarify")}>Request clarification</button>
          <button className="btn btn-danger" disabled={a.pending} onClick={() => go("reject", "Reject this submission?")}>Reject</button>
        </div>
      )}
      {decided && <button className="btn" disabled={a.pending} onClick={() => go("reopen", "Reopen for amendment? This unlocks the approved values.")}>Reopen for amendment</button>}
      <button className="btn btn-ghost btn-sm" disabled={a.pending || !msg.trim()} onClick={() => go("note")}>Add as internal note only</button>
      <Feedback a={a} />
    </div>
  );
}

export function ExportButtons({ submissionId }: { submissionId: string }) {
  const a = useAction();
  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn-sm" disabled={a.pending} onClick={() => a.exec(() => exportAndEmailAction(submissionId, "resend"))}>Resend latest PDF</button>
        <button className="btn btn-sm" disabled={a.pending} onClick={() => a.exec(() => exportAndEmailAction(submissionId, "regenerate"))}>Regenerate & email</button>
      </div>
      <Feedback a={a} />
    </div>
  );
}
