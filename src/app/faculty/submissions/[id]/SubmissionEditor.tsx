"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Policy, ResearchSection } from "@/server/policy/schema";
import type { ResearchEntry, ScoreLine, SubmissionContent, TeachingRow } from "@/server/domain/schemas";
import type { Preview } from "@/server/services/submissions";
import type { FieldError } from "@/server/scoring/validate";
import { previewAction, saveDraftAction, submitAction } from "@/app/actions/faculty";
import { FieldInput } from "@/components/FieldInput";
import { fmtDate, fmtDateTime, fmtINR, fmtPoints } from "@/lib/format";
import { isHidden } from "@/lib/policyView";

type Profile = { name: string; designation: string; category: string; doj: string | null; email: string; researchStatus: string; doe: string | null };
type Props = {
  submissionId: string;
  initialRev: number;
  policy: Policy;
  initialContent: SubmissionContent;
  initialPreview: Preview;
  profile: Profile;
  ay: { label: string; startDate: string; endDate: string; closeAt: string };
  isResubmission: boolean;
  clarification: string | null;
};

const TABS = ["profile", "teaching", "research", "service", "review"] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { profile: "1. Profile", teaching: "2. Teaching", research: "3. Research", service: "4. Service", review: "5. Review & submit" };

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 12) : Math.random().toString(36).slice(2, 14));

export function SubmissionEditor(p: Props) {
  const router = useRouter();
  const [content, setContent] = useState<SubmissionContent>(p.initialContent);
  const [rev, setRev] = useState(p.initialRev);
  const [preview, setPreview] = useState<Preview>(p.initialPreview);
  const [serverErrors, setServerErrors] = useState<FieldError[]>([]);
  const [tab, setTab] = useState<Tab>("profile");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad" | "warn"; text: string } | null>(null);
  const [declaration, setDeclaration] = useState(false);
  const [response, setResponse] = useState("");
  const [saving, startSaving] = useTransition();
  const [submitting, startSubmitting] = useTransition();
  const confirmRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef(content);
  contentRef.current = content;

  // ---- live server-side preview (debounced)
  useEffect(() => {
    const t = setTimeout(async () => {
      const res = await previewAction(p.submissionId, content, tab === "review" ? "submit" : "draft");
      if (res.ok) {
        setPreview(res.data);
        setServerErrors([]);
      }
    }, 500);
    return () => clearTimeout(t);
  }, [content, tab, p.submissionId]);

  const save = useCallback(
    (quiet = false) =>
      new Promise<boolean>((resolve) => {
        startSaving(async () => {
          const snapshot = contentRef.current;
          const res = await saveDraftAction(p.submissionId, rev, snapshot);
          if (res.ok) {
            setRev(res.data.rev);
            setPreview(res.data.preview);
            setSavedAt(res.data.savedAt);
            setServerErrors([]);
            if (contentRef.current === snapshot) setDirty(false);
            if (!quiet) setNotice({ tone: "ok", text: "Draft saved." });
            resolve(true);
          } else {
            setServerErrors(res.fieldErrors ?? []);
            setNotice({ tone: "bad", text: res.error });
            resolve(false);
          }
        });
      }),
    [p.submissionId, rev],
  );

  // ---- autosave 20 s after the last change; warn before leaving with unsaved changes
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void save(true), 20_000);
    return () => clearTimeout(t);
  }, [dirty, content, save]);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  useEffect(() => {
    if (!notice || notice.tone === "bad") return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  const update = (fn: (c: SubmissionContent) => SubmissionContent) => {
    setContent((c) => fn(c));
    setDirty(true);
  };

  const errors = useMemo(() => {
    const m = new Map<string, string>();
    for (const e of [...preview.errors, ...serverErrors]) if (!m.has(e.path)) m.set(e.path, e.message);
    return m;
  }, [preview.errors, serverErrors]);
  const tabErrors = (t: Tab) => [...errors.keys()].some((k) => k.startsWith(t === "service" ? "service" : t));
  const lines = useMemo(() => new Map(preview.score.lines.map((l) => [l.lineId, l])), [preview]);

  const doSubmit = () => {
    startSubmitting(async () => {
      const res = await submitAction(p.submissionId, rev, content, declaration, response);
      confirmRef.current?.close();
      if (res.ok) {
        setDirty(false);
        router.push(`/faculty/submissions/${p.submissionId}?submitted=1`);
        router.refresh();
      } else {
        setServerErrors(res.fieldErrors ?? []);
        setNotice({ tone: "bad", text: res.error });
      }
    });
  };

  const t = preview.score.totals;
  const e = preview.eligibility;
  const total = Number(t.R) + Number(t.T) + Number(t.S);

  return (
    <div className="layout-side">
      <div className="stack">
        {p.clarification && (
          <div className="alert alert-warn">
            <div>
              <div className="strong">Clarification requested by Admin</div>
              <p style={{ whiteSpace: "pre-wrap" }}>{p.clarification}</p>
              <p className="small" style={{ marginTop: 4 }}>Update your entries as needed and resubmit from step 5.</p>
            </div>
          </div>
        )}
        <div className="card">
          <div className="tabs" role="tablist" aria-label="Submission sections" style={{ padding: "0 12px" }}>
            {TABS.map((k) => (
              <button key={k} role="tab" type="button" className="tab" aria-selected={tab === k} aria-controls={`panel-${k}`} id={`tab-${k}`} onClick={() => setTab(k)}>
                {TAB_LABEL[k]}
                {k === "research" && content.research.length > 0 && <span className="count">{content.research.length}</span>}
                {k === "teaching" && content.teaching.length > 0 && <span className="count">{content.teaching.length}</span>}
                {k !== "review" && k !== "profile" && tabErrors(k) && <span className="dot-err" aria-label="has errors" />}
              </button>
            ))}
          </div>
          <div className="card-body" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === "profile" && <ProfileTab profile={p.profile} ay={p.ay} />}
            {tab === "teaching" && <TeachingTab policy={p.policy} rows={content.teaching} errors={errors} lines={lines} preview={preview} update={update} />}
            {tab === "research" && <ResearchTab policy={p.policy} entries={content.research} errors={errors} lines={lines} update={update} />}
            {tab === "service" && <ServiceTab policy={p.policy} content={content} errors={errors} lines={lines} update={update} />}
            {tab === "review" && (
              <ReviewTab
                policy={p.policy}
                content={content}
                preview={preview}
                errors={errors}
                declaration={declaration}
                setDeclaration={setDeclaration}
                isResubmission={p.isResubmission}
                response={response}
                setResponse={setResponse}
                onSubmit={() => confirmRef.current?.showModal()}
                goTo={setTab}
                submitting={submitting}
                notes={content.facultyNotes}
                setNotes={(v) => update((c) => ({ ...c, facultyNotes: v }))}
              />
            )}
          </div>
          <div className="card-foot row-between">
            <button type="button" className="btn" disabled={tab === "profile"} onClick={() => setTab(TABS[Math.max(0, TABS.indexOf(tab) - 1)]!)}>
              ← Back
            </button>
            <span className="small muted">{dirty ? "Unsaved changes" : savedAt ? `Saved ${fmtDateTime(savedAt)}` : "All changes saved"}</span>
            {tab !== "review" ? (
              <button type="button" className="btn btn-primary" onClick={() => setTab(TABS[TABS.indexOf(tab) + 1]!)}>
                Next →
              </button>
            ) : (
              <span />
            )}
          </div>
        </div>
      </div>

      <aside className="sticky stack">
        <div className="card">
          <div className="card-head">
            <div>
              <h2>Provisional points</h2>
              <p>Calculated on the server from policy {preview.score.policyVersion}</p>
            </div>
          </div>
          <div className="card-body stack">
            <div className="points-grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
              <div className="point-tile"><div className="k">R</div><div className="v">{fmtPoints(t.R)}</div></div>
              <div className="point-tile"><div className="k">T</div><div className="v">{fmtPoints(t.T)}</div></div>
              <div className="point-tile"><div className="k">S</div><div className="v">{fmtPoints(t.S)}</div></div>
            </div>
            <dl className="kv">
              <dt>Total earned</dt><dd className="num strong">{fmtPoints(total)}</dd>
              <dt>Minimum required</dt><dd className="num">{fmtPoints(e.minimum)}</dd>
              <dt>Points payable</dt><dd className="num strong">{fmtPoints(e.pointsPayable)}</dd>
              <dt>Indicative payment</dt><dd className="num">{fmtINR(e.payment)}</dd>
            </dl>
            {preview.score.warnings.length > 0 && (
              <details>
                <summary className="small" style={{ color: "var(--warn)" }}>{preview.score.warnings.length} item(s) will be reviewed by Admin</summary>
                <ul className="small" style={{ paddingLeft: 18, margin: "6px 0 0" }}>
                  {preview.score.warnings.map((w, i) => (
                    <li key={i}>{w.message}</li>
                  ))}
                </ul>
              </details>
            )}
            <button type="button" className="btn btn-primary btn-block" disabled={saving} onClick={() => void save()}>
              {saving ? "Saving…" : "Save draft"}
            </button>
            <p className="tiny muted">Drafts also save automatically. Submission closes {fmtDate(p.ay.closeAt)}.</p>
          </div>
        </div>
      </aside>

      {notice && (
        <div className={`toast alert alert-${notice.tone}`} role={notice.tone === "bad" ? "alert" : "status"}>
          <div>
            {notice.text}
            {serverErrors.length > 0 && (
              <ul>
                {serverErrors.slice(0, 6).map((x) => (
                  <li key={x.path}>{x.message}</li>
                ))}
              </ul>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => setNotice(null)} aria-label="Dismiss">✕</button>
        </div>
      )}

      <dialog ref={confirmRef} className="modal" aria-labelledby="confirm-title">
        <div className="modal-head"><h2 id="confirm-title">Submit for review?</h2></div>
        <div className="modal-body stack">
          <p>After submitting you can no longer edit unless the Admin returns it for clarification. A PDF copy will be emailed to <strong>{p.profile.email}</strong>.</p>
          <dl className="kv">
            <dt>R / T / S</dt><dd>{fmtPoints(t.R)} / {fmtPoints(t.T)} / {fmtPoints(t.S)}</dd>
            <dt>Total earned</dt><dd>{fmtPoints(total)}</dd>
          </dl>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => confirmRef.current?.close()}>Cancel</button>
          <button className="btn btn-success" disabled={submitting} onClick={doSubmit}>{submitting ? "Submitting…" : "Submit"}</button>
        </div>
      </dialog>
    </div>
  );
}

// ------------------------------------------------------------------ Tabs

function ProfileTab({ profile, ay }: { profile: Profile; ay: Props["ay"] }) {
  return (
    <div className="stack">
      <div className="alert alert-info">These details come from the Faculty Master List maintained by the RTS Admin. If something is wrong, contact the Admin — you can request an email correction after submitting.</div>
      <dl className="kv">
        <dt>Academic year</dt><dd>{ay.label} ({fmtDate(ay.startDate)} – {fmtDate(ay.endDate)})</dd>
        <dt>Name</dt><dd>{profile.name}</dd>
        <dt>Designation</dt><dd>{profile.designation}</dd>
        <dt>Faculty category</dt><dd>{profile.category}</dd>
        <dt>Date of joining</dt><dd>{fmtDate(profile.doj)}</dd>
        <dt>Research status</dt><dd>{profile.researchStatus}</dd>
        {profile.doe && <><dt>Date of exit</dt><dd>{fmtDate(profile.doe)}</dd></>}
        <dt>Email (exports are sent here)</dt><dd>{profile.email}</dd>
      </dl>
    </div>
  );
}

function LinePoints({ line }: { line?: ScoreLine }) {
  if (!line) return null;
  return (
    <div className="small" style={{ marginTop: 8 }}>
      <span className={`badge ${line.reviewRequired ? "badge-warn" : Number(line.points) > 0 ? "badge-ok" : "badge-neutral"}`}>{fmtPoints(line.points)} pts</span>{" "}
      <span className="muted">{line.explanation}</span>
    </div>
  );
}

function TeachingTab({ policy, rows, errors, lines, preview, update }: { policy: Policy; rows: TeachingRow[]; errors: Map<string, string>; lines: Map<string, ScoreLine>; preview: Preview; update: (fn: (c: SubmissionContent) => SubmissionContent) => void }) {
  const cols = policy.teaching.columns;
  const types = policy.teaching.courseTypes ?? [];
  const [batch, setBatch] = useState("5");
  const setRow = (id: string, patch: Partial<TeachingRow>) => update((c) => ({ ...c, teaching: c.teaching.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const blankRow = (): TeachingRow => ({ id: uid(), courseName: "", courseType: "", sections: "", students: "", feedback: "", hours: {}, notes: "" });
  const add = (n = 1) => update((c) => ({ ...c, teaching: [...c.teaching, ...Array.from({ length: n }, blankRow)] }));
  const remove = (id: string) => update((c) => ({ ...c, teaching: c.teaching.filter((r) => r.id !== id) }));
  const ti = preview.score.teachingInfo;
  const err = (k: string) => errors.get(k);
  return (
    <div className="stack">
      <div className="row-between">
        <div>
          <h2>Teaching</h2>
          <p className="small muted">One row per course or teaching assignment. Enter hours under each programme that applies. Leave feedback blank if not available. Rows left completely empty are ignored when you submit.</p>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => add(1)}>+ Add course</button>
          <label htmlFor="add-rows" className="sr-only">Number of rows to add</label>
          <select id="add-rows" className="input" style={{ width: 70 }} value={batch} onChange={(e) => setBatch(e.target.value)}>
            {["5", "10", "15", "20"].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <button type="button" className="btn btn-primary" onClick={() => add(Number(batch))}>+ Add {batch} rows</button>
        </div>
      </div>
      {cols.filter((c) => c.signoff === "PENDING" && c.note).map((c) => <div key={c.key} className="alert alert-warn small">{c.note}</div>)}
      {policy.teaching.pointsConversion.signoff === "PENDING" && <div className="alert alert-warn small">{policy.teaching.pointsConversion.note}</div>}
      {rows.length === 0 ? (
        <div className="empty">No courses added. Use “Add course” for each course you taught in this period.</div>
      ) : (
        <div className="table-wrap">
          <table className="table table-compact" style={{ minWidth: 1100 }}>
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Course name</th>
                {types.length > 0 && <th style={{ minWidth: 170 }}>Course type</th>}
                <th>Sections</th>
                <th>Students</th>
                <th>Feedback</th>
                {cols.map((c) => <th key={c.key} title={c.label}>{c.label}</th>)}
                <th className="num">T pts</th>
                <th><span className="sr-only">Remove</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const ln = lines.get(`T:${r.id}`);
                const base = `teaching.${r.id}`;
                return (
                  <tr key={r.id}>
                    <td>
                      <input className="input" aria-label={`Course ${i + 1} name`} value={r.courseName} aria-invalid={err(`${base}.courseName`) ? true : undefined} onChange={(e) => setRow(r.id, { courseName: e.target.value })} />
                      {(err(`${base}.courseName`) || err(`${base}.hours`)) && <div className="err tiny" style={{ color: "var(--bad)" }}>{err(`${base}.courseName`) ?? err(`${base}.hours`)}</div>}
                    </td>
                    {types.length > 0 && (
                      <td>
                        <select className="input" aria-label={`Course ${i + 1} type`} value={r.courseType} aria-invalid={err(`${base}.courseType`) ? true : undefined} onChange={(e) => setRow(r.id, { courseType: e.target.value })}>
                          <option value="">—</option>
                          {types.map((t) => <option key={t.key} value={t.key}>{t.label} ({t.pointsPerHour}/h)</option>)}
                        </select>
                        {err(`${base}.courseType`) && <div className="tiny" style={{ color: "var(--bad)" }}>{err(`${base}.courseType`)}</div>}
                      </td>
                    )}
                    {(["sections", "students", "feedback"] as const).map((k) => (
                      <td key={k}><input className="input input-num" style={{ width: 72 }} inputMode="decimal" aria-label={`Course ${i + 1} ${k}`} aria-invalid={err(`${base}.${k}`) ? true : undefined} value={r[k]} onChange={(e) => setRow(r.id, { [k]: e.target.value })} /></td>
                    ))}
                    {cols.map((c) => (
                      <td key={c.key}><input className="input input-num" style={{ width: 70 }} inputMode="decimal" aria-label={`Course ${i + 1} ${c.label} hours`} aria-invalid={err(`${base}.hours.${c.key}`) ? true : undefined} value={r.hours[c.key] ?? ""} onChange={(e) => setRow(r.id, { hours: { ...r.hours, [c.key]: e.target.value } })} /></td>
                    ))}
                    <td className="num strong" title={ln?.explanation}>{fmtPoints(ln?.points ?? "0")}</td>
                    <td><button type="button" className="btn btn-ghost btn-sm" aria-label={`Remove course ${i + 1}`} onClick={() => remove(r.id)}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <div className="grid-4">
        <div className="point-tile"><div className="k">Total hours</div><div className="v">{fmtPoints(ti.totalHours)}</div></div>
        <div className="point-tile"><div className="k">CLD hours</div><div className="v">{fmtPoints(ti.cldHours)}</div></div>
        <div className="point-tile"><div className="k">Hours toward cap / cap</div><div className="v">{fmtPoints(ti.hoursCountedForCap)} / {fmtPoints(ti.capHours)}</div></div>
        <div className="point-tile"><div className="k">Contractual load</div><div className="v">{fmtPoints(ti.contractualLoadHours)} h</div></div>
      </div>
      {Number(ti.cldHours) > 0 && ti.cldCompensation !== null && <p className="small muted">CLD is shown separately: {fmtPoints(ti.cldHours)} h → {fmtINR(ti.cldCompensation)} at your designation&apos;s CLD rate (not part of the points payment).</p>}
      {Number(ti.cldHours) > 0 && ti.cldCompensation === null && <p className="small muted">CLD hours are recorded for information; they earn no T points and are excluded from the points payment.</p>}
    </div>
  );
}

function ResearchTab({ policy, entries, errors, lines, update }: { policy: Policy; entries: ResearchEntry[]; errors: Map<string, string>; lines: Map<string, ScoreLine>; update: (fn: (c: SubmissionContent) => SubmissionContent) => void }) {
  const add = (s: ResearchSection) => update((c) => ({ ...c, research: [...c.research, { id: uid(), sectionKey: s.key, values: Object.fromEntries(s.fields.map((f) => [f.key, f.type === "boolean" ? false : null])) }] }));
  const set = (id: string, key: string, v: string | boolean | null) =>
    update((c) => ({ ...c, research: c.research.map((e) => (e.id === id ? { ...e, values: { ...e.values, [key]: v } } : e)) }));
  const remove = (id: string) => update((c) => ({ ...c, research: c.research.filter((e) => e.id !== id) }));
  return (
    <div className="stack">
      <div>
        <h2>Research</h2>
        <p className="small muted">Add one entry per activity. Sections with zero points are recorded for disclosure. Points are calculated from the configured Guidelines.</p>
      </div>
      {policy.researchSections.map((s) => {
        const list = entries.filter((e) => e.sectionKey === s.key);
        const sum = list.reduce((a, e) => a + Number(lines.get(`R:${e.id}`)?.points ?? 0), 0);
        return (
          <section key={s.key} className="section-block stack" aria-labelledby={`sec-${s.key}`}>
            <div className="row-between">
              <div>
                <h3 id={`sec-${s.key}`}>
                  {s.label} <span className="badge badge-neutral">{list.length}</span> {list.length > 0 && <span className="badge badge-brand">{fmtPoints(sum)} pts</span>}
                </h3>
                {s.help && <p className="small muted">{s.help}</p>}
              </div>
              <button type="button" className="btn btn-sm" onClick={() => add(s)}>+ Add</button>
            </div>
            {list.map((e, i) => (
              <div key={e.id} className="entry">
                <div className="entry-head">
                  <span className="strong small">{s.label} #{i + 1}</span>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => remove(e.id)}>Remove</button>
                </div>
                <div className="entry-body">
                  <div className="form-grid">
                    {s.fields.filter((f) => !isHidden(f, e.values)).map((f) => (
                      <FieldInput key={f.key} policy={policy} field={f} value={e.values[f.key] ?? null} values={e.values} error={errors.get(`research.${e.id}.${f.key}`)} idPrefix={e.id} onChange={(v) => set(e.id, f.key, v)} />
                    ))}
                  </div>
                  <LinePoints line={lines.get(`R:${e.id}`)} />
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function ServiceTab({ policy, content, errors, lines, update }: { policy: Policy; content: SubmissionContent; errors: Map<string, string>; lines: Map<string, ScoreLine>; update: (fn: (c: SubmissionContent) => SubmissionContent) => void }) {
  const setRole = (key: string, patch: Partial<{ quantity: string; description: string }>) =>
    update((c) => {
      const cur = c.service.roles[key] ?? { quantity: "", description: "" };
      return { ...c, service: { ...c.service, roles: { ...c.service.roles, [key]: { ...cur, ...patch } } } };
    });
  const setDisc = (key: string, v: string) => update((c) => ({ ...c, service: { ...c.service, disclosures: { ...c.service.disclosures, [key]: v } } }));
  return (
    <div className="stack">
      <div>
        <h2>Service</h2>
        <p className="small muted">Tick every responsibility you held during the period — you can hold several roles at the same time. For conferences, committees and guidance, enter the number. Anything not listed can go under “Other service / additional roles”.</p>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Responsibility</th><th>Held / number</th><th>Details (optional)</th><th className="num">Points</th></tr>
          </thead>
          <tbody>
            {policy.service.roles.map((r) => {
              const v = content.service.roles[r.key] ?? { quantity: "", description: "" };
              const ln = lines.get(`S:${r.key}`);
              const id = `svc-${r.key}`;
              return (
                <tr key={r.key}>
                  <td>
                    <label htmlFor={id}>{r.label}</label>
                    <div className="tiny muted">{r.zeroReason ?? `${r.points} points${r.quantity === "COUNT" ? " each" : ""}${r.maxQuantity ? `, up to ${r.maxQuantity}` : ""}`}</div>
                  </td>
                  <td>
                    {r.quantity === "FLAG" ? (
                      <input id={id} type="checkbox" style={{ width: 18, height: 18 }} checked={Number(v.quantity) > 0} onChange={(e) => setRole(r.key, { quantity: e.target.checked ? "1" : "" })} />
                    ) : (
                      <input id={id} className="input input-num" style={{ width: 80 }} inputMode="numeric" value={v.quantity} aria-invalid={errors.get(`service.roles.${r.key}.quantity`) ? true : undefined} onChange={(e) => setRole(r.key, { quantity: e.target.value.replace(/[^\d]/g, "") })} />
                    )}
                    {errors.get(`service.roles.${r.key}.quantity`) && <div className="tiny" style={{ color: "var(--bad)" }}>{errors.get(`service.roles.${r.key}.quantity`)}</div>}
                  </td>
                  <td><input className="input" aria-label={`${r.label} details`} placeholder={r.descriptionLabel ?? "Programme / period / notes"} value={v.description} onChange={(e) => setRole(r.key, { description: e.target.value })} /></td>
                  <td className="num strong">{ln ? fmtPoints(ln.points) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <section className="section-block stack">
        <div>
          <h3>Other service (not scored)</h3>
          <p className="small muted">{policy.service.disclosureNote}</p>
        </div>
        <div className="form-grid">
          {policy.service.disclosures.map((d) => (
            <div key={d.key} className={`field${d.type === "textarea" ? " span-2" : ""}`}>
              <label htmlFor={`disc-${d.key}`}>{d.label}</label>
              {d.type === "textarea" ? (
                <textarea id={`disc-${d.key}`} className="input" rows={2} value={content.service.disclosures[d.key] ?? ""} onChange={(e) => setDisc(d.key, e.target.value)} />
              ) : (
                <input id={`disc-${d.key}`} className="input input-num" inputMode="numeric" value={content.service.disclosures[d.key] ?? ""} onChange={(e) => setDisc(d.key, e.target.value.replace(/[^\d]/g, ""))} />
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReviewTab(props: {
  policy: Policy;
  content: SubmissionContent;
  preview: Preview;
  errors: Map<string, string>;
  declaration: boolean;
  setDeclaration: (v: boolean) => void;
  isResubmission: boolean;
  response: string;
  setResponse: (v: string) => void;
  onSubmit: () => void;
  goTo: (t: Tab) => void;
  submitting: boolean;
  notes: string;
  setNotes: (v: string) => void;
}) {
  const { policy, content, preview, errors } = props;
  const errList = [...errors.entries()];
  const sectionOf = (path: string): Tab => (path.startsWith("teaching") ? "teaching" : path.startsWith("research") ? "research" : path.startsWith("service") ? "service" : "review");
  return (
    <div className="stack">
      <div>
        <h2>Review & submit</h2>
        <p className="small muted">Check the summary below. Every section appears in your PDF — empty sections are shown as “Nil”.</p>
      </div>
      {errList.length > 0 ? (
        <div className="alert alert-bad" role="alert">
          <div>
            <div className="strong">Please fix {errList.length} item(s) before submitting</div>
            <ul>
              {errList.slice(0, 12).map(([k, m]) => (
                <li key={k}>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ padding: 0, minHeight: 0 }} onClick={() => props.goTo(sectionOf(k))}>{m}</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        <div className="alert alert-ok">All required information is complete.</div>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Section</th><th>Entries</th><th className="num">Points</th></tr></thead>
          <tbody>
            <tr><td>Teaching</td><td>{content.teaching.length || "Nil"}</td><td className="num">{fmtPoints(preview.score.totals.T)}</td></tr>
            {policy.researchSections.map((s) => {
              const ids = content.research.filter((e) => e.sectionKey === s.key).map((e) => `R:${e.id}`);
              const pts = preview.score.lines.filter((l) => ids.includes(l.lineId)).reduce((a, l) => a + Number(l.points), 0);
              return <tr key={s.key}><td>{s.label}</td><td>{ids.length || "Nil"}</td><td className="num">{fmtPoints(pts)}</td></tr>;
            })}
            <tr><td>Service</td><td>{preview.score.lines.filter((l) => l.category === "S").map((l) => l.label).join(", ") || "Nil"}</td><td className="num">{fmtPoints(preview.score.totals.S)}</td></tr>
          </tbody>
        </table>
      </div>
      <details>
        <summary className="small strong">Calculation details ({preview.score.lines.length} lines)</summary>
        <ul className="small" style={{ paddingLeft: 18 }}>
          {preview.score.lines.map((l) => (
            <li key={l.lineId}><strong>{l.category}</strong> · {l.detail}: {fmtPoints(l.points)} — <span className="muted">{l.explanation}</span></li>
          ))}
          {preview.eligibility.explanation.map((x) => <li key={x}>{x}</li>)}
        </ul>
      </details>
      <div className="field">
        <label htmlFor="faculty-notes">Notes for the Admin (optional)</label>
        <textarea id="faculty-notes" className="input" rows={3} value={props.notes} onChange={(e) => props.setNotes(e.target.value)} />
      </div>
      {props.isResubmission && (
        <div className="field">
          <label htmlFor="response">Your response to the clarification request</label>
          <textarea id="response" className="input" rows={3} value={props.response} onChange={(e) => props.setResponse(e.target.value)} />
        </div>
      )}
      <label className="check">
        <input type="checkbox" checked={props.declaration} onChange={(e) => props.setDeclaration(e.target.checked)} />
        <span>I confirm that the information entered is complete and accurate, and I understand points are provisional until approved by the Admin.</span>
      </label>
      {errors.get("declaration") && <span className="err small" style={{ color: "var(--bad)" }}>Please confirm the declaration.</span>}
      <div>
        <button type="button" className="btn btn-success" disabled={!props.declaration || errList.length > 0 || props.submitting} onClick={props.onSubmit}>
          {props.isResubmission ? "Resubmit for review" : "Submit for review"}
        </button>
      </div>
    </div>
  );
}
