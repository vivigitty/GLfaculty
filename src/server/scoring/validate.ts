import type { Policy } from "../policy/schema";
import type { SubmissionContent } from "../domain/schemas";
import { isHidden, resolveOptions, visibleOptions } from "@/lib/policyView";

export type FieldError = { path: string; message: string };

const NUM = /^\d+(\.\d+)?$/;
const INT = /^\d+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LIMIT = { text: 500, textarea: 4000 };

function blank(v: unknown) {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

/**
 * Validates submission content against the policy-driven form definition.
 * `draft` mode checks formats only; `submit` mode also enforces required fields.
 * Messages are written to be shown next to the field.
 */
export function validateContent(content: SubmissionContent, policy: Policy, mode: "draft" | "submit"): FieldError[] {
  const errors: FieldError[] = [];
  const cols = new Set(policy.teaching.columns.map((c) => c.key));

  content.teaching.forEach((row, i) => {
    const p = `teaching.${row.id}`;
    if (mode === "submit" && blank(row.courseName)) errors.push({ path: `${p}.courseName`, message: `Course ${i + 1}: enter the course name.` });
    if (row.courseType && policy.teaching.courseTypes && !policy.teaching.courseTypes.some((t) => t.key === row.courseType)) {
      errors.push({ path: `${p}.courseType`, message: `Course ${i + 1}: choose a valid course type.` });
    }
    if (row.courseName.length > LIMIT.text) errors.push({ path: `${p}.courseName`, message: "Course name is too long." });
    for (const [k, label] of [["sections", "Sections"], ["students", "Students"]] as const) {
      if (!blank(row[k]) && !INT.test(row[k].trim())) errors.push({ path: `${p}.${k}`, message: `Course ${i + 1}: ${label} must be a whole number.` });
    }
    if (!blank(row.feedback) && !NUM.test(row.feedback.trim())) errors.push({ path: `${p}.feedback`, message: `Course ${i + 1}: feedback must be a number (leave blank if unavailable).` });
    for (const [k, v] of Object.entries(row.hours)) {
      if (!cols.has(k)) errors.push({ path: `${p}.hours.${k}`, message: `Unknown teaching column ${k}.` });
      else if (!blank(v) && !NUM.test(v.trim())) errors.push({ path: `${p}.hours.${k}`, message: `Course ${i + 1}: hours must be a non-negative number.` });
    }
    if (mode === "submit") {
      const any = Object.values(row.hours).some((v) => !blank(v) && Number(v) > 0);
      if (!any) errors.push({ path: `${p}.hours`, message: `Course ${i + 1}: enter hours in at least one programme column.` });
    }
  });

  for (const entry of content.research) {
    const section = policy.researchSections.find((s) => s.key === entry.sectionKey);
    if (!section) {
      errors.push({ path: `research.${entry.id}`, message: `Unknown research section ${entry.sectionKey}.` });
      continue;
    }
    for (const f of section.fields) {
      const v = entry.values[f.key];
      const p = `research.${entry.id}.${f.key}`;
      const label = `${section.label}: ${f.label}`;
      if (isHidden(f, entry.values)) continue;
      if (blank(v)) {
        if (mode === "submit" && f.required) errors.push({ path: p, message: `${label} is required.` });
        continue;
      }
      switch (f.type) {
        case "boolean":
          if (typeof v !== "boolean") errors.push({ path: p, message: `${label} must be Yes or No.` });
          break;
        case "select": {
          const opts = mode === "submit" ? visibleOptions(policy, f, entry.values) : resolveOptions(policy, f);
          if (!opts.some((o) => o.key === v)) errors.push({ path: p, message: `${label}: choose a valid option.` });
          break;
        }
        case "number":
        case "money":
          if (typeof v !== "string" || !NUM.test(v.replace(/,/g, "").trim())) errors.push({ path: p, message: `${label} must be a non-negative number.` });
          break;
        case "integer":
          if (typeof v !== "string" || !INT.test(v.trim()) || (f.min !== undefined && Number(v) < f.min)) {
            errors.push({ path: p, message: `${label} must be a whole number${f.min !== undefined ? ` of at least ${f.min}` : ""}.` });
          }
          break;
        case "date":
          if (typeof v !== "string" || !DATE.test(v) || Number.isNaN(Date.parse(v))) errors.push({ path: p, message: `${label} must be a valid date.` });
          break;
        case "url":
        case "text":
        case "textarea":
          if (typeof v !== "string") errors.push({ path: p, message: `${label} must be text.` });
          else if (v.length > LIMIT[f.type === "textarea" ? "textarea" : "text"]) errors.push({ path: p, message: `${label} is too long.` });
          break;
      }
    }
    for (const k of Object.keys(entry.values)) {
      if (!section.fields.some((f) => f.key === k)) errors.push({ path: `research.${entry.id}.${k}`, message: `Unknown field ${k}.` });
    }
  }

  const roleKeys = new Set(policy.service.roles.map((r) => r.key));
  for (const [k, v] of Object.entries(content.service.roles)) {
    if (!roleKeys.has(k)) errors.push({ path: `service.roles.${k}`, message: `Service role ${k} is not available.` });
    else if (!blank(v.quantity) && !INT.test(v.quantity.trim())) errors.push({ path: `service.roles.${k}.quantity`, message: "Quantity must be a whole number." });
    if (v.description.length > LIMIT.textarea) errors.push({ path: `service.roles.${k}.description`, message: "Description is too long." });
  }
  const discKeys = new Map(policy.service.disclosures.map((d) => [d.key, d]));
  for (const [k, v] of Object.entries(content.service.disclosures)) {
    const d = discKeys.get(k);
    if (!d) errors.push({ path: `service.disclosures.${k}`, message: `Unknown disclosure ${k}.` });
    else if (d.type === "integer" && !blank(v) && !INT.test(v.trim())) errors.push({ path: `service.disclosures.${k}`, message: `${d.label} must be a whole number.` });
  }
  if (content.facultyNotes.length > LIMIT.textarea) errors.push({ path: "facultyNotes", message: "Notes are too long." });
  return errors;
}
