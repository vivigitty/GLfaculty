"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createPolicyVersionAction } from "@/app/actions/admin";
import { useAction } from "@/components/useAction";
import { PARAM_GROUPS, checkParamValue, type PolicyParam } from "@/lib/policyParams";

type Year = { id: string; label: string; policyVersion: string; startDate: string };

export function PolicyEditor(p: {
  baseVersion: string;
  baseLabel: string;
  params: PolicyParam[];
  versions: string[];
  suggestedVersion: string;
  defaultEffectiveFrom: string;
  years: Year[];
}) {
  const router = useRouter();
  const a = useAction();
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(p.params.map((x) => [x.id, x.value])));
  const [newVersion, setNewVersion] = useState(p.suggestedVersion);
  const [label, setLabel] = useState(p.baseLabel);
  const [effectiveFrom, setEffectiveFrom] = useState(p.defaultEffectiveFrom);
  const [assignTo, setAssignTo] = useState("");
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);

  const changed = useMemo(() => p.params.filter((x) => values[x.id]?.trim() !== x.value), [p.params, values]);
  const localErrors = useMemo(() => {
    const m = new Map<string, string>();
    for (const x of changed) {
      const e = checkParamValue(x, values[x.id] ?? "");
      if (e) m.set(x.id, e);
    }
    return m;
  }, [changed, values]);
  const fe = a.fieldErrors;
  const q = filter.trim().toLowerCase();
  const visible = p.params.filter((x) => (!q || `${x.group} ${x.label}`.toLowerCase().includes(q)) && (!onlyChanged || changed.includes(x)));
  const set = (id: string, v: string) => setValues((s) => ({ ...s, [id]: v }));

  const save = () => {
    const edits = Object.fromEntries(changed.map((x) => [x.id, values[x.id] ?? ""]));
    a.exec(
      () => createPolicyVersionAction({ baseVersion: p.baseVersion, newVersion, label, effectiveFrom, edits, assignToYearId: assignTo || null }, reason),
      (d) => router.push(`/admin/policy?v=${encodeURIComponent(d.version)}`),
    );
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="card-head"><div><h2>New version</h2><p>Name, effective date and where to use it.</p></div></div>
        <div className="card-body">
          <div className="form-grid">
            <div className="field">
              <label htmlFor="pv-name" className="req">Version name</label>
              <input id="pv-name" className="input mono" value={newVersion} onChange={(e) => setNewVersion(e.target.value)} aria-invalid={fe.newVersion ? true : undefined} />
              {p.versions.includes(newVersion.trim()) ? <span className="err">Already exists — choose a new name.</span> : fe.newVersion ? <span className="err">{fe.newVersion}</span> : <span className="hint">For example 2026-27.v1 for next year.</span>}
            </div>
            <div className="field">
              <label htmlFor="pv-eff" className="req">Effective from</label>
              <input id="pv-eff" type="date" className="input" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
              {fe.effectiveFrom && <span className="err">{fe.effectiveFrom}</span>}
            </div>
            <div className="field span-2">
              <label htmlFor="pv-label" className="req">Description</label>
              <input id="pv-label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} />
              {fe.label && <span className="err">{fe.label}</span>}
            </div>
            <div className="field span-2">
              <label htmlFor="pv-year">Use for academic year</label>
              <select id="pv-year" className="input" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
                <option value="">Don&apos;t assign now (assign later in Academic years)</option>
                {p.years.map((y) => <option key={y.id} value={y.id}>{y.label} — currently {y.policyVersion}</option>)}
              </select>
              {fe.assignToYearId ? <span className="err">{fe.assignToYearId}</span> : <span className="hint">Allowed only while nothing has been submitted for that year. Drafts switch to the new values.</span>}
            </div>
            <div className="field span-2">
              <label htmlFor="pv-reason" className="req">Reason for the change</label>
              <input id="pv-reason" className="input" placeholder="e.g. Owner-approved points revision, Nov 2026" value={reason} onChange={(e) => setReason(e.target.value)} aria-invalid={fe.reason ? true : undefined} />
              {fe.reason && <span className="err">{fe.reason}</span>}
            </div>
          </div>
        </div>
      </div>

      <div className="row-between" style={{ flexWrap: "wrap", gap: 12 }}>
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <label htmlFor="pv-filter" className="sr-only">Filter values</label>
          <input id="pv-filter" className="input" style={{ width: 280 }} placeholder="Filter, e.g. Area Chair, grant, Professor" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <label className="check"><input type="checkbox" checked={onlyChanged} onChange={(e) => setOnlyChanged(e.target.checked)} /> Show changed only</label>
        </div>
        <span className="small"><strong>{changed.length}</strong> value(s) changed</span>
      </div>

      {PARAM_GROUPS.map((g) => {
        const rows = visible.filter((x) => x.group === g);
        if (!rows.length) return null;
        return (
          <div key={g} className="card">
            <div className="card-head"><div><h2>{g}</h2></div></div>
            <div className="table-wrap">
              <table className="table table-compact">
                <thead><tr><th>Value</th><th className="num" style={{ width: 140 }}>Current</th><th style={{ width: 260 }}>New</th></tr></thead>
                <tbody>
                  {rows.map((x) => {
                    const v = values[x.id] ?? "";
                    const err = localErrors.get(x.id) ?? fe[`edits.${x.id}`];
                    const isChanged = v.trim() !== x.value;
                    const inputId = `pv-${x.id}`;
                    return (
                      <tr key={x.id} style={isChanged ? { background: "var(--surface-2)" } : undefined}>
                        <td>
                          <label htmlFor={inputId} className="small">{x.label}</label>
                          {x.hint && <div className="tiny muted">{x.hint}</div>}
                        </td>
                        <td className="num small muted">{display(x, x.value)}</td>
                        <td>
                          <Input id={inputId} param={x} value={v} onChange={(nv) => set(x.id, nv)} invalid={Boolean(err)} />
                          {err && <div className="tiny" style={{ color: "var(--bad)" }}>{err}</div>}
                          {isChanged && !err && <button type="button" className="btn btn-ghost btn-sm" style={{ paddingLeft: 0 }} onClick={() => set(x.id, x.value)}>Undo</button>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="card" style={{ position: "sticky", bottom: 0, zIndex: 2 }}>
        <div className="card-body row-between" style={{ flexWrap: "wrap", gap: 12 }}>
          <div className="small">
            {a.error ? <span role="alert" style={{ color: "var(--bad)" }}>{a.error}</span> : changed.length === 0 ? "No values changed yet — you can still save a copy for another year." : `${changed.length} change(s) will be saved as ${newVersion || "a new version"}.`}
          </div>
          <button type="button" className="btn btn-primary" disabled={a.pending || localErrors.size > 0 || !reason.trim() || !newVersion.trim() || p.versions.includes(newVersion.trim())} onClick={save}>
            {a.pending ? "Saving…" : "Save as new version"}
          </button>
        </div>
      </div>
    </div>
  );
}

function display(x: PolicyParam, v: string): string {
  if (x.kind.type === "bool" || x.kind.type === "member") return v === "true" ? "Yes" : "No";
  if (x.kind.type === "enum") return x.kind.options.find((o) => o.value === v)?.label ?? v;
  if (x.kind.type === "matrixCell" && v === "") return `range ${x.kind.range ?? ""} → Admin/Dean`;
  return v === "" ? "—" : v;
}

function Input({ id, param, value, onChange, invalid }: { id: string; param: PolicyParam; value: string; onChange: (v: string) => void; invalid: boolean }) {
  const k = param.kind;
  if (k.type === "bool" || k.type === "member") {
    return (
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }
  if (k.type === "enum") {
    return (
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined}>
        {k.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  return (
    <input
      id={id}
      className="input input-num"
      inputMode="decimal"
      value={value}
      placeholder={k.type === "matrixCell" && k.range ? `range ${k.range}` : undefined}
      onChange={(e) => onChange(e.target.value)}
      aria-invalid={invalid || undefined}
    />
  );
}
