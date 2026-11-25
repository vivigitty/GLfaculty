"use client";

import { useState } from "react";
import { adjustCategoryAction, bulkLineStatusAction, recomputeOneAction, exportAndEmailAction, lineReviewAction, reviewAction } from "@/app/actions/admin";
import { useAction } from "@/components/useAction";
import type { RTS, ScoreLine } from "@/server/domain/schemas";
import { fmtPoints } from "@/lib/format";
import type { LineDetail } from "@/lib/lineDetails";

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

export type ReviewLine = { line: ScoreLine; review: LineReview; detail: LineDetail };

/**
 * Score lines with bulk verification: tick lines (or "Select all"), then mark them Verified in one
 * step, so only suspicious lines need individual attention. Each row expands to show what led to its points.
 */
export function ScoreLinesTable({ submissionId, rev, rows, editable }: { submissionId: string; rev: number; rows: ReviewLine[]; editable: boolean }) {
  const a = useAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const ids = rows.map((r) => r.line.lineId);
  const allSelected = ids.length > 0 && ids.every((x) => selected.has(x));
  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const select = (pred: (r: ReviewLine) => boolean) => setSelected(new Set(rows.filter(pred).map((r) => r.line.lineId)));
  const verified = rows.filter((r) => r.review?.status === "VERIFIED").length;
  const bulk = (status: "VERIFIED" | "UNVERIFIED") => a.exec(() => bulkLineStatusAction(submissionId, rev, [...selected], status), () => setSelected(new Set()));
  const cols = editable ? 8 : 7;
  return (
    <div className="stack">
      <div className="row-between" style={{ padding: "10px 14px 0" }}>
        <span className="small">
          <strong>{verified}</strong> of {rows.length} line(s) verified{rows.length > verified && <span className="muted"> · approval needs every line verified</span>}
        </span>
        {editable && rows.length > 0 && (
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => select(() => true)}>Select all</button>
            <button className="btn btn-ghost btn-sm" onClick={() => select((r) => !r.line.reviewRequired && r.detail.warnings.length === 0 && r.review?.status !== "VERIFIED")} title="Lines without review flags or warnings that are not yet verified">Select unflagged</button>
            <button className="btn btn-ghost btn-sm" disabled={selected.size === 0} onClick={() => setSelected(new Set())}>Clear</button>
            <button className="btn btn-success btn-sm" disabled={a.pending || selected.size === 0} onClick={() => bulk("VERIFIED")}>Mark {selected.size || ""} verified</button>
            <button className="btn btn-sm" disabled={a.pending || selected.size === 0} onClick={() => bulk("UNVERIFIED")}>Mark unverified</button>
          </div>
        )}
      </div>
      <div style={{ padding: "0 14px" }}><Feedback a={a} /></div>
      <div className="table-wrap">
        <table className="table table-compact">
          <thead>
            <tr>
              {editable && (
                <th style={{ width: 28 }}>
                  <input type="checkbox" aria-label="Select all score lines" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(ids))} disabled={ids.length === 0} />
                </th>
              )}
              <th style={{ width: 28 }} /><th>Cat.</th><th>Activity</th><th /><th className="num">Submitted</th><th className="num">Approved</th><th>Verification</th><th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={cols + 1} className="muted">No scored lines.</td></tr>}
            {rows.map((r) => (
              <LineReviewRow key={r.line.lineId} submissionId={submissionId} rev={rev} line={r.line} review={r.review} detail={r.detail} editable={editable} selected={selected.has(r.line.lineId)} onToggle={() => toggle(r.line.lineId)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DetailList({ title, items }: { title: string; items: { label: string; value: string }[] }) {
  return (
    <div>
      <h4 className="small strong" style={{ margin: "0 0 4px" }}>{title}</h4>
      <dl className="kv small">
        {items.map((x, i) => [<dt key={`${i}-k`}>{x.label}</dt>, <dd key={`${i}-v`} style={{ whiteSpace: "pre-wrap" }}>{x.value}</dd>])}
      </dl>
    </div>
  );
}

/** Per-line verification, optional approved-points override, and an expandable "how these points arose" panel. */
export function LineReviewRow({ submissionId, rev, line, review, detail, editable, selected, onToggle }: { submissionId: string; rev: number; line: ScoreLine; review: LineReview; detail: LineDetail; editable: boolean; selected: boolean; onToggle: () => void }) {
  const a = useAction();
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState(review?.status ?? "UNVERIFIED");
  const [note, setNote] = useState(review?.note ?? "");
  const [pts, setPts] = useState(review?.approvedPoints ?? "");
  const [reason, setReason] = useState("");
  const approved = review?.approvedPoints ?? line.points;
  const tone = { VERIFIED: "badge-ok", DISPUTED: "badge-bad", NEEDS_EVIDENCE: "badge-warn" }[review?.status ?? ""] ?? "badge-neutral";
  const span = editable ? 9 : 8;
  return (
    <>
      <tr style={selected ? { background: "var(--brand-soft)" } : undefined}>
        {editable && (
          <td><input type="checkbox" aria-label={`Select ${line.detail}`} checked={selected} onChange={onToggle} /></td>
        )}
        <td>
          <button className="btn btn-ghost btn-sm" style={{ padding: "0 4px" }} onClick={() => setExpanded(!expanded)} aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} details for ${line.detail}`}>
            {expanded ? "▾" : "▸"}
          </button>
        </td>
        <td><span className="badge badge-brand">{line.category}</span></td>
        <td>
          <div className="strong small">{line.detail}</div>
          <div className="tiny muted">{line.label} · {line.explanation}</div>
          {review?.note && <div className="tiny"><strong>Note:</strong> {review.note}</div>}
        </td>
        <td>
          {line.reviewRequired && <span className="badge badge-warn">Review</span>}
          {detail.warnings.length > 0 && <span className="badge badge-warn" title={detail.warnings.join("\n")}>{detail.warnings.length} warning{detail.warnings.length > 1 ? "s" : ""}</span>}
        </td>
        <td className="num">{fmtPoints(line.points)}</td>
        <td className="num strong" style={{ color: approved !== line.points ? "var(--brand)" : undefined }}>{fmtPoints(approved)}</td>
        <td><span className={`badge ${tone}`}>{(review?.status ?? "UNVERIFIED").replace(/_/g, " ").toLowerCase()}</span></td>
        <td>{editable && <button className="btn btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Close" : "Review"}</button>}</td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={span} style={{ background: "var(--surface-2)" }}>
            <div className="form-grid">
              <div className="span-2"><DetailList title="As entered by faculty" items={detail.source} /></div>
              <div className="span-2"><DetailList title="Calculation" items={detail.calculation} /></div>
            </div>
            {detail.warnings.length > 0 && (
              <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--warn)" }}>
                {detail.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            )}
            {review?.reason && <p className="tiny" style={{ marginTop: 6 }}><strong>Override reason:</strong> {review.reason}</p>}
          </td>
        </tr>
      )}
      {open && editable && (
        <tr>
          <td colSpan={span} style={{ background: "var(--surface-2)" }}>
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
export function DecisionPanel({ submissionId, rev, status, unverified }: { submissionId: string; rev: number; status: string; unverified: number }) {
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
          <button className="btn btn-success" disabled={a.pending || unverified > 0} title={unverified > 0 ? `${unverified} score line(s) still need verification` : undefined} onClick={() => go("approve", "Approve and lock this submission? The final PDF will be generated and emailed.")}>Approve & lock</button>
          <button className="btn" disabled={a.pending} onClick={() => go("clarify")}>Request clarification</button>
          <button className="btn btn-danger" disabled={a.pending} onClick={() => go("reject", "Reject this submission?")}>Reject</button>
        </div>
      )}
      {reviewable && unverified > 0 && <p className="tiny muted" style={{ margin: 0 }}>Approve & lock is enabled once all score lines are verified ({unverified} remaining).</p>}
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

/** Shown when the academic year's policy has changed since this record was scored. */
export function RecomputeNow({ submissionId, from, to }: { submissionId: string; from: string; to: string }) {
  const a = useAction();
  const [reason, setReason] = useState("");
  return (
    <div className="stack">
      <p className="small" style={{ margin: 0 }}>
        Scored under <strong>{from}</strong>; the year now uses <strong>{to}</strong>. Recompute to re-score the submitted content under {to}; the faculty member is emailed the old and new submitted points. Approval is blocked until then.
      </p>
      <div className="row">
        <input className="input" style={{ maxWidth: 420 }} aria-label="Reason for recompute" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={a.pending} onClick={() => window.confirm(`Recompute under ${to} and email the faculty member?`) && a.exec(() => recomputeOneAction(submissionId, reason))}>Recompute now</button>
      </div>
      <Feedback a={a} />
    </div>
  );
}
