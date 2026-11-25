import type { Policy } from "@/server/policy/schema";
import type { ScoreLine, ScoreSnapshot, SubmissionContent } from "@/server/domain/schemas";
import { fmtDate, fmtINR, fmtPoints, nil } from "./format";
import { isHidden, optionLabel } from "./policyView";

/**
 * "What led to these points" for one score line: the source entry exactly as the faculty member
 * entered it, the calculation inputs, and any review warnings attached to the line.
 * Pure — used by the Admin review page to render expandable rows.
 */
export type LineDetail = {
  source: { label: string; value: string }[];
  calculation: { label: string; value: string }[];
  warnings: string[];
};

export function lineDetails(line: ScoreLine, content: SubmissionContent, policy: Policy, score: Pick<ScoreSnapshot, "warnings">): LineDetail {
  const source: LineDetail["source"] = [];
  const calculation: LineDetail["calculation"] = [];
  const id = line.lineId.slice(2); // "R:<entryId>", "T:<rowId>", "S:<roleKey>"

  if (line.category === "T") {
    const row = content.teaching.find((r) => r.id === id);
    if (row) {
      source.push({ label: "Course", value: nil(row.courseName) });
      source.push({ label: "Course type", value: nil(policy.teaching.courseTypes?.find((c) => c.key === row.courseType)?.label ?? row.courseType) });
      source.push({ label: "Sections", value: nil(row.sections) });
      source.push({ label: "Students", value: nil(row.students) });
      source.push({ label: "Feedback", value: nil(row.feedback) });
      for (const c of policy.teaching.columns) source.push({ label: `${c.label} hours`, value: nil(row.hours[c.key]) });
      if (row.notes.trim()) source.push({ label: "Notes", value: row.notes });
    }
    calculation.push({ label: "Hours counted for points", value: fmtPoints(line.basePoints) });
    calculation.push({ label: "Points per hour", value: fmtPoints(line.multiplier) });
  } else if (line.category === "R") {
    const entry = content.research.find((e) => e.id === id);
    const section = policy.researchSections.find((s) => s.key === entry?.sectionKey);
    if (entry && section) {
      source.push({ label: "Section", value: section.label });
      for (const f of section.fields) {
        if (isHidden(f, entry.values)) continue;
        const v = entry.values[f.key];
        const shown =
          f.type === "select" ? optionLabel(policy, f, v) : f.type === "date" ? (v ? fmtDate(String(v)) : "") : f.type === "money" && v ? fmtINR(String(v)) : v;
        source.push({ label: f.label, value: nil(shown as string | boolean | null) });
      }
    }
    calculation.push({ label: "Base points", value: fmtPoints(line.basePoints) });
    calculation.push({ label: "Factor / share", value: fmtPoints(line.multiplier) });
  } else {
    const role = policy.service.roles.find((r) => r.key === id);
    const v = content.service.roles[id];
    source.push({ label: "Responsibility", value: role?.label ?? id });
    source.push({ label: "Quantity entered", value: nil(v?.quantity) });
    source.push({ label: "Details", value: nil(v?.description) });
    calculation.push({ label: "Points per unit", value: fmtPoints(line.basePoints) });
    calculation.push({ label: "Quantity counted", value: fmtPoints(line.multiplier) });
  }
  calculation.push({ label: "Points", value: fmtPoints(line.points) });
  calculation.push({ label: "How", value: line.explanation });
  calculation.push({ label: "Eligible for compensation", value: line.compensationEligible ? "Yes" : "No" });

  const warnings = score.warnings.filter((w) => w.lineId === line.lineId).map((w) => w.message);
  return { source, calculation, warnings };
}
