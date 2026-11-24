"use client";

import type { FieldDef, Policy } from "@/server/policy/schema";
import { visibleOptions } from "@/lib/policyView";

type Value = string | boolean | null;

/** Renders one policy-defined field. Adding a field to the policy YAML adds it here automatically. */
export function FieldInput({
  policy,
  field,
  value,
  values,
  error,
  idPrefix,
  disabled,
  onChange,
}: {
  policy: Policy;
  field: FieldDef;
  value: Value;
  values: Record<string, Value>;
  error?: string;
  idPrefix: string;
  disabled?: boolean;
  onChange: (v: Value) => void;
}) {
  const id = `${idPrefix}-${field.key}`;
  const errId = error ? `${id}-err` : undefined;
  const common = { id, disabled, "aria-invalid": error ? true : undefined, "aria-describedby": errId };
  const str = typeof value === "string" ? value : "";

  let control: React.ReactNode;
  switch (field.type) {
    case "boolean":
      return (
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <label className="check" htmlFor={id}>
            <input type="checkbox" {...common} checked={value === true} onChange={(e) => onChange(e.target.checked)} />
            <span>{field.label}</span>
          </label>
          {error && <span className="err" id={errId}>{error}</span>}
        </div>
      );
    case "select": {
      const opts = visibleOptions(policy, field, values);
      control = (
        <select className="input" {...common} value={str} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">— Select —</option>
          {opts.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
              {o.points !== undefined && o.eligible !== false ? ` (${o.points} pts)` : o.eligible === false ? " (not eligible)" : ""}
            </option>
          ))}
        </select>
      );
      break;
    }
    case "textarea":
      control = <textarea className="input" {...common} value={str} rows={2} maxLength={4000} onChange={(e) => onChange(e.target.value)} />;
      break;
    case "date":
      control = <input type="date" className="input" {...common} value={str} onChange={(e) => onChange(e.target.value || null)} />;
      break;
    case "number":
    case "money":
    case "integer":
      control = (
        <input
          className="input input-num"
          inputMode={field.type === "integer" ? "numeric" : "decimal"}
          {...common}
          value={str}
          placeholder={field.type === "money" ? "₹" : undefined}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
        />
      );
      break;
    default:
      control = <input className="input" type={field.type === "url" ? "url" : "text"} {...common} value={str} maxLength={500} onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    <div className={`field${field.type === "textarea" ? " span-2" : ""}`}>
      <label htmlFor={id} className={field.required ? "req" : undefined}>
        {field.label}
      </label>
      {control}
      {error && (
        <span className="err" id={errId}>
          {error}
        </span>
      )}
    </div>
  );
}
