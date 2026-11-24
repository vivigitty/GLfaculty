import Decimal from "decimal.js";
import type { Policy, ResearchSection } from "../policy/schema";
import type { FacultySnapshot, RTS, ScoreLine, ScoreSnapshot, SubmissionContent } from "../domain/schemas";
import { resolveOptions } from "@/lib/policyView";

/**
 * Pure, deterministic RTS scoring. No I/O. Every number is a Decimal; results are
 * serialized as decimal strings. Ambiguous or unconfirmed rules produce warnings
 * and `reviewRequired` lines instead of guessed values.
 */

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Period = { startDate: string; endDate: string };
type Warning = ScoreSnapshot["warnings"][number];

const ZERO = new Decimal(0);

export function dec(v: unknown): Decimal | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/,/g, "").trim();
  if (s === "" || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  return new Decimal(s);
}
const s = (d: Decimal) => d.toFixed();

function line(partial: Omit<ScoreLine, "basePoints" | "multiplier" | "points"> & { base: Decimal; mult: Decimal; pts: Decimal }): ScoreLine {
  const { base, mult, pts, ...rest } = partial;
  return { ...rest, basePoints: s(base), multiplier: s(mult), points: s(pts) };
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

// ------------------------------------------------------------------ Research
function scoreResearchEntry(
  policy: Policy,
  section: ResearchSection,
  entryId: string,
  values: Record<string, string | boolean | null>,
  warnings: Warning[],
): ScoreLine {
  const lineId = `R:${entryId}`;
  const title = String(values.title ?? values.journal ?? values.student ?? values.conference ?? "").trim() || "(untitled)";
  const common = { lineId, category: "R" as const, section: section.key, label: section.label, detail: title };
  const warn = (code: string, message: string) => warnings.push({ code, message: `${section.label} — ${title}: ${message}`, lineId });

  if (section.calc === "zero") {
    return line({ ...common, base: ZERO, mult: ZERO, pts: ZERO, compensationEligible: false, reviewRequired: false, explanation: section.zeroReason ?? "Zero points." });
  }

  if (section.calc === "lookup") {
    const field = section.fields.find((f) => f.key === section.lookupField);
    const chosen = field ? resolveOptions(policy, field).find((o) => o.key === values[section.lookupField ?? ""]) : undefined;
    if (!chosen) {
      warn("INCOMPLETE", "type not selected; no points calculated.");
      return line({ ...common, base: ZERO, mult: ZERO, pts: ZERO, compensationEligible: false, reviewRequired: true, explanation: "Type not selected." });
    }
    const base = dec(chosen.points) ?? ZERO;
    const eligible = chosen.eligible !== false;
    const pts = eligible ? base : ZERO;
    const parts = [`${chosen.label}: ${s(pts)} points.`];
    if (chosen.note) parts.push(chosen.note);
    if (section.reviewNote && pts.gt(0)) parts.push(section.reviewNote);
    const pending = chosen.signoff === "PENDING";
    if (pending) warn("VALUE_PENDING_SIGNOFF", `${chosen.label}: point value awaits owner sign-off; Admin to confirm.`);
    return line({
      ...common,
      detail: `${title} (${chosen.label})`,
      base,
      mult: new Decimal(eligible ? 1 : 0),
      pts,
      compensationEligible: pts.gt(0),
      reviewRequired: pending || Boolean(section.reviewNote && pts.gt(0)),
      explanation: parts.join(" "),
    });
  }

  if (section.calc === "grant") {
    const total = dec(values.totalAmount);
    const n = dec(values.participatingFaculty);
    if (!total || !n || n.lte(0) || !n.isInteger()) {
      warn("INCOMPLETE", "grant amount or participating faculty missing; no points calculated.");
      return line({ ...common, base: ZERO, mult: ZERO, pts: ZERO, compensationEligible: false, reviewRequired: true, explanation: "Grant amount / participants missing." });
    }
    const share = total.div(n);
    let pts = ZERO;
    let tierText = "";
    for (const t of policy.grant.tiers) {
      if (t.below !== undefined && share.lt(t.below)) {
        pts = new Decimal(t.points);
        tierText = `share < ₹${t.below}`;
        break;
      }
      if (t.upToInclusive !== undefined && share.lte(t.upToInclusive)) {
        pts = new Decimal(t.points);
        tierText = `share ≤ ₹${t.upToInclusive}`;
        break;
      }
      if (t.below === undefined && t.upToInclusive === undefined) {
        pts = new Decimal(t.points);
        tierText = "highest tier";
        break;
      }
    }
    return line({
      ...common,
      base: pts,
      mult: new Decimal(1),
      pts,
      compensationEligible: pts.gt(0),
      reviewRequired: false,
      explanation: `₹${s(total)} ÷ ${s(n)} faculty = individual share ₹${share.toDecimalPlaces(2).toFixed()} (${tierText}) → ${s(pts)} points.`,
    });
  }

  // publication
  const pub = policy.publication;
  const cls = pub.classes.find((c) => c.key === values.publicationClass);
  if (!cls) {
    warn("INCOMPLETE", "publication class not selected.");
    return line({ ...common, base: ZERO, mult: ZERO, pts: ZERO, compensationEligible: false, reviewRequired: true, explanation: "Publication class not selected." });
  }
  const base = new Decimal(cls.basePoints);
  if (values.paidJournal === true) {
    warn("PAID_JOURNAL", "paid journal — zero points under the Guidelines.");
    return line({ ...common, base, mult: ZERO, pts: dec(pub.paidJournalPoints) ?? ZERO, compensationEligible: false, reviewRequired: true, explanation: "Paid journal: zero points (Guidelines)." });
  }
  const coAuthors = values.coAuthorCount;
  if (coAuthors === "NONE") {
    const f = new Decimal(pub.soleAuthor.factor);
    const pending = pub.soleAuthor.signoff === "PENDING";
    if (pending) warn("SOLE_AUTHOR_PENDING", pub.soleAuthor.note ?? "sole-author factor pending sign-off.");
    return line({ ...common, base, mult: f, pts: base.mul(f), compensationEligible: true, reviewRequired: pending, explanation: `${cls.label}: ${s(base)} × sole-author factor ${s(f)} = ${s(base.mul(f))}.` });
  }
  const cell = pub.contributionMatrix.find(
    (c) => c.coAuthors === coAuthors && c.contribution === values.contribution && c.mix === values.affiliationMix,
  );
  if (!cell) {
    warn("NEEDS_ADMIN_REVIEW", "author combination is not an exact cell of the Guidelines contribution table; Admin/Dean must decide.");
    return line({ ...common, base, mult: ZERO, pts: ZERO, compensationEligible: false, reviewRequired: true, explanation: `${cls.label}: ${s(base)} base points; contribution share needs Admin/Dean decision (no matching table cell).` });
  }
  if (cell.range !== undefined) {
    warn("NEEDS_ADMIN_REVIEW", `Guidelines give a range (${cell.range}); Admin/Dean must set the share.`);
    return line({ ...common, base, mult: ZERO, pts: ZERO, compensationEligible: false, reviewRequired: true, explanation: `${cls.label}: ${s(base)} base points; Guidelines share is a range (${cell.range}) — Admin/Dean decision required.` });
  }
  const f = new Decimal(cell.factor ?? "0");
  let review = false;
  if (values.contribution === "EQUAL" && values.equalContributionStated !== true) {
    review = true;
    warn("EQUAL_NOT_STATED", "equal contribution claimed but not confirmed as stated in the author notes.");
  }
  return line({
    ...common,
    base,
    mult: f,
    pts: base.mul(f),
    compensationEligible: true,
    reviewRequired: review,
    explanation: `${cls.label}: ${s(base)} × contribution factor ${s(f)} = ${s(base.mul(f))}.`,
  });
}

// ------------------------------------------------------------------ Main entry
export function scoreSubmission(input: {
  content: SubmissionContent;
  policy: Policy;
  faculty: FacultySnapshot;
  period: Period;
  now?: Date;
}): ScoreSnapshot {
  const { content, policy, faculty, period } = input;
  const lines: ScoreLine[] = [];
  const warnings: Warning[] = [];
  const designation = policy.designations.items.find((d) => d.key === faculty.designationKey);

  // ---- Teaching
  const conv = policy.teaching.pointsConversion;
  const perHour = new Decimal(conv.pointsPerHour);
  let totalHours = ZERO;
  let cldHours = ZERO;
  let pointHours = ZERO;
  let capHours = ZERO;
  const pendingCols = new Map<string, string>();
  for (const row of content.teaching) {
    let rowTotal = ZERO;
    let rowPointHours = ZERO;
    for (const col of policy.teaching.columns) {
      const h = dec(row.hours[col.key]) ?? ZERO;
      rowTotal = rowTotal.add(h);
      if (!conv.excludedColumns.includes(col.key)) rowPointHours = rowPointHours.add(h);
      if (!policy.teaching.capExcludedColumns.includes(col.key)) capHours = capHours.add(h);
      if (col.key === "cld") cldHours = cldHours.add(h);
      if (h.gt(0) && col.signoff === "PENDING") pendingCols.set(col.key, col.note ?? `${col.label}: treatment awaits owner sign-off.`);
    }
    totalHours = totalHours.add(rowTotal);
    pointHours = pointHours.add(rowPointHours);
    const excluded = policy.teaching.columns.filter((c) => conv.excludedColumns.includes(c.key)).map((c) => c.label);
    const detail = row.courseName.trim() || "(unnamed course)";
    // Course-type rate (e.g. large elective 1.25 point/h) when the row qualifies; otherwise the default rate.
    let rate = perHour;
    let rateNote = "";
    let rowReview = conv.signoff === "PENDING";
    const ct = policy.teaching.courseTypes?.find((c) => c.key === row.courseType);
    if (ct) {
      const sections = dec(row.sections);
      const students = dec(row.students);
      const perSection = students && sections && sections.gt(0) ? students.div(sections) : students;
      if (ct.minStudentsPerSection !== undefined && (!perSection || perSection.lt(ct.minStudentsPerSection))) {
        rateNote = ` ${ct.label} needs ≥ ${ct.minStudentsPerSection} students per section (entered: ${perSection ? perSection.toDecimalPlaces(1).toFixed() : "Nil"}); default rate used.`;
        rowReview = true;
        warnings.push({ code: "COURSE_TYPE_NOT_MET", message: `Teaching — ${detail}:${rateNote}`, lineId: `T:${row.id}` });
      } else {
        rate = new Decimal(ct.pointsPerHour);
        rateNote = ` ${ct.label} rate.`;
        if (!rate.eq(perHour)) rowReview = true; // enhanced rate: Admin verifies section size / evaluation
      }
    }
    lines.push(
      line({
        lineId: `T:${row.id}`,
        category: "T",
        section: "TEACHING",
        label: "Teaching",
        detail,
        base: rowPointHours,
        mult: rate,
        pts: rowPointHours.mul(rate),
        compensationEligible: rowPointHours.gt(0),
        reviewRequired: rowReview,
        explanation: `${s(rowTotal)} h total; ${s(rowPointHours)} h counted${excluded.length ? ` (excl. ${excluded.join(", ")})` : ""} × ${s(rate)} point/h.${rateNote}`,
      }),
    );
  }
  for (const [col, note] of pendingCols) warnings.push({ code: "TEACHING_COLUMN_PENDING", message: note, lineId: `T:${col}` });
  if (content.teaching.length > 0 && conv.signoff === "PENDING") {
    warnings.push({ code: "TEACHING_CONVERSION_PENDING", message: conv.note ?? "Teaching hours → points conversion pending sign-off.", lineId: null });
  }
  const status = policy.researchStatuses.find((r) => r.key === faculty.researchStatus);
  const cap = new Decimal(status?.teachingCapHours ?? 225);
  let load = new Decimal(status?.contractualLoadHours ?? 120);
  if (faculty.designationKey === "ASSISTANT_PROFESSOR" && faculty.dateOfJoining) {
    const yrs = daysBetween(faculty.dateOfJoining, period.endDate) / 365;
    if (yrs < policy.teaching.newAssistantProfessor.firstYearsOfService) load = new Decimal(policy.teaching.newAssistantProfessor.contractualLoadHours);
  }
  if (capHours.gt(cap)) {
    warnings.push({
      code: "TEACHING_CAP_EXCEEDED",
      message: `Teaching hours counted towards the cap (${s(capHours)} h) exceed the ${s(cap)} h cap; deviations need case-by-case Dean approval.`,
      lineId: null,
    });
  }
  const cldRate = policy.teaching.cld.showCompensationSeparately && designation?.cldRatePerHour ? new Decimal(designation.cldRatePerHour) : null;
  if (cldHours.gt(0) && policy.teaching.cld.signoff === "PENDING") {
    warnings.push({ code: "CLD_TREATMENT_PENDING", message: policy.teaching.cld.note ?? "CLD treatment pending sign-off.", lineId: null });
  }

  // ---- Research
  for (const entry of content.research) {
    const section = policy.researchSections.find((x) => x.key === entry.sectionKey);
    if (!section) {
      warnings.push({ code: "UNKNOWN_SECTION", message: `Research entry in unknown section ${entry.sectionKey} ignored.`, lineId: `R:${entry.id}` });
      continue;
    }
    lines.push(scoreResearchEntry(policy, section, entry.id, entry.values, warnings));
  }
  // "Best N" sections: only the N highest-scoring entries earn points (ties keep entry order).
  for (const section of policy.researchSections) {
    const max = section.maxScoredEntries;
    if (!max) continue;
    const idx = lines.map((l, i) => ({ l, i })).filter((x) => x.l.category === "R" && x.l.section === section.key && new Decimal(x.l.points).gt(0));
    if (idx.length <= max) continue;
    const keep = new Set([...idx].sort((a, b) => new Decimal(b.l.points).cmp(a.l.points) || a.i - b.i).slice(0, max).map((x) => x.i));
    for (const { l, i } of idx) {
      if (keep.has(i)) continue;
      lines[i] = { ...l, points: "0", multiplier: "0", compensationEligible: false, explanation: `${l.explanation} Not scored: only the best ${max} entries in ${section.label} count.` };
    }
  }

  // ---- Service
  for (const role of policy.service.roles) {
    const entered = dec(content.service.roles[role.key]?.quantity) ?? ZERO;
    if (entered.lte(0)) continue;
    const q = role.maxQuantity !== undefined ? Decimal.min(entered, role.maxQuantity) : entered;
    const per = new Decimal(role.points);
    const pts = q.mul(per);
    const capped = q.lt(entered);
    const pending = role.signoff === "PENDING";
    if (pending) warnings.push({ code: "VALUE_PENDING_SIGNOFF", message: `${role.label}: ${role.note ?? "point value awaits owner sign-off"}`, lineId: `S:${role.key}` });
    const desc = content.service.roles[role.key]?.description.trim() ?? "";
    lines.push(
      line({
        lineId: `S:${role.key}`,
        category: "S",
        section: "SERVICE",
        label: role.label,
        detail: desc || role.label,
        base: per,
        mult: q,
        pts,
        compensationEligible: pts.gt(0),
        reviewRequired: pending,
        explanation:
          role.zeroReason ??
          `${s(q)} × ${s(per)} points = ${s(pts)}.${capped ? ` ${s(entered)} entered; capped at the maximum of ${role.maxQuantity}.` : ""}`,
      }),
    );
    if (role.quantity === "FLAG" && q.gt(1)) {
      warnings.push({ code: "FLAG_QUANTITY", message: `${role.label} entered with quantity ${s(q)}; single-holder role — Admin to verify.`, lineId: `S:${role.key}` });
    }
  }

  const sum = (cat: "R" | "T" | "S") => lines.filter((l) => l.category === cat).reduce((a, l) => a.add(l.points), ZERO);
  return {
    policyVersion: policy.version,
    calculatedAt: (input.now ?? new Date()).toISOString(),
    lines,
    totals: { R: s(sum("R")), T: s(sum("T")), S: s(sum("S")) },
    teachingInfo: {
      totalHours: s(totalHours),
      cldHours: s(cldHours),
      hoursForPoints: s(pointHours),
      capHours: s(cap),
      hoursCountedForCap: s(capHours),
      contractualLoadHours: s(load),
      cldCompensation: cldRate ? s(cldHours.mul(cldRate)) : null,
    },
    warnings,
  };
}

// ------------------------------------------------------------------ Eligibility & payment
export type Eligibility = {
  earned: string;
  baseMinimum: string;
  minimum: string;
  prorationFactor: string | null;
  pointsPayable: string;
  researchRate: string;
  designationRate: string | null;
  researchBandPoints: string;
  designationBandPoints: string;
  paymentExact: string | null;
  payment: string | null;
  explanation: string[];
  warnings: string[];
};

export function minimumPoints(
  policy: Policy,
  faculty: Pick<FacultySnapshot, "facultyCategory" | "dateOfJoining"> & { dateOfExit?: string | null },
  period: Period,
) {
  const base = new Decimal(policy.parameters.minimumPoints[faculty.facultyCategory]);
  const pr = policy.parameters.prorating;
  const warnings: string[] = [];
  const exit = faculty.dateOfExit ?? null;
  if (!pr.enabled || (!faculty.dateOfJoining && !exit)) return { base, minimum: base, factor: null as Decimal | null, warnings };
  if ((faculty.dateOfJoining && faculty.dateOfJoining > period.endDate) || (exit && exit < period.startDate)) {
    warnings.push("Faculty was not in service during the reporting period; minimum set to zero — Admin to verify.");
    return { base, minimum: ZERO, factor: ZERO, warnings };
  }
  const pending = pr.signoff === "PENDING" ? " — prorating convention pending sign-off." : ".";

  if (pr.basis === "PERIOD_DAYS") {
    // Days in service inside the period (both ends inclusive) ÷ days in the period (inclusive; handles leap years).
    const from = faculty.dateOfJoining && faculty.dateOfJoining > period.startDate ? faculty.dateOfJoining : period.startDate;
    const to = exit && exit < period.endDate ? exit : period.endDate;
    const served = Math.max(daysBetween(from, to) + 1, 0);
    const total = daysBetween(period.startDate, period.endDate) + 1;
    if (served >= total) return { base, minimum: base, factor: null, warnings };
    const factor = new Decimal(served).div(total);
    const why = [from !== period.startDate ? `joined ${from}` : "", to !== period.endDate ? `exit ${to}` : ""].filter(Boolean).join(", ");
    warnings.push(`Minimum prorated (${why}): ${served} of ${total} days in service = ${factor.toDecimalPlaces(4).toFixed()}${pending}`);
    return { base, minimum: base.mul(factor), factor, warnings };
  }

  if (!faculty.dateOfJoining) return { base, minimum: base, factor: null, warnings };
  const days = daysBetween(faculty.dateOfJoining, period.endDate) + (pr.dayCount === "END_INCLUSIVE" ? 1 : 0);
  const years = new Decimal(days).div(pr.daysInYear);
  if (years.gte(1)) return { base, minimum: base, factor: null, warnings };
  const minimum = base.mul(years);
  warnings.push(`Minimum prorated for service of ${days} days ÷ ${pr.daysInYear} = ${years.toDecimalPlaces(4).toFixed()} year(s)${pending}`);
  return { base, minimum, factor: years, warnings };
}

export function eligibilityAndPayment(
  points: RTS,
  policy: Policy,
  faculty: Pick<FacultySnapshot, "facultyCategory" | "dateOfJoining" | "designationKey"> & { dateOfExit?: string | null },
  period: Period,
): Eligibility {
  const R = new Decimal(points.R);
  const earned = R.add(points.T).add(points.S);
  const { base, minimum, factor, warnings } = minimumPoints(policy, faculty, period);
  const P = Decimal.max(earned.sub(minimum), 0);
  const rr = new Decimal(policy.parameters.researchRatePerPoint);
  const designation = policy.designations.items.find((d) => d.key === faculty.designationKey);
  const dr = designation ? new Decimal(designation.pointRate) : null;
  const explanation = [
    `Earned points = R ${R.toFixed()} + T ${points.T} + S ${points.S} = ${earned.toFixed()}.`,
    `Minimum required = ${minimum.toDecimalPlaces(4).toFixed()} (${faculty.facultyCategory === "JUNIOR" ? "Junior Faculty" : "Standard"} base ${base.toFixed()}${factor ? ", prorated" : ""}).`,
    `Points payable P = max(${earned.toFixed()} − ${minimum.toDecimalPlaces(4).toFixed()}, 0) = ${P.toDecimalPlaces(4).toFixed()}.`,
  ];
  if (!designation) warnings.push(`Designation "${faculty.designationKey}" has no configured rate; payment cannot be estimated.`);
  if (designation && policy.designations.pointRateSignoff === "PENDING") warnings.push("Designation point rates are pending sign-off.");

  const researchBand = Decimal.min(P, R);
  const designationBand = P.sub(researchBand);
  let exact: Decimal | null = null;
  if (P.lte(R)) {
    exact = P.mul(rr);
    explanation.push(`P ≤ R, so payment = P × research rate = ${P.toDecimalPlaces(4).toFixed()} × ₹${rr.toFixed()} = ₹${exact.toDecimalPlaces(2).toFixed()}.`);
  } else if (dr) {
    exact = R.mul(rr).add(designationBand.mul(dr));
    explanation.push(
      `P > R, so payment = R × research rate + (P − R) × designation rate = ${R.toFixed()} × ₹${rr.toFixed()} + ${designationBand.toDecimalPlaces(4).toFixed()} × ₹${dr.toFixed()} = ₹${exact.toDecimalPlaces(2).toFixed()}.`,
    );
  }
  const mode = policy.parameters.paymentRounding;
  const rounded = exact
    ? mode === "NEAREST_RUPEE"
      ? exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      : mode === "CEIL_RUPEE"
        ? exact.toDecimalPlaces(0, Decimal.ROUND_CEIL)
        : exact
    : null;
  if (exact && mode === "CEIL_RUPEE" && !rounded?.eq(exact)) explanation.push(`Rounded up to the next rupee: ₹${rounded?.toFixed()}.`);
  return {
    earned: earned.toFixed(),
    baseMinimum: base.toFixed(),
    minimum: minimum.toFixed(),
    prorationFactor: factor ? factor.toFixed() : null,
    pointsPayable: P.toFixed(),
    researchRate: rr.toFixed(),
    designationRate: dr ? dr.toFixed() : null,
    researchBandPoints: researchBand.toFixed(),
    designationBandPoints: designationBand.toFixed(),
    paymentExact: exact ? exact.toFixed() : null,
    payment: rounded ? rounded.toFixed() : null,
    explanation,
    warnings,
  };
}

export function totalOf(p: RTS): string {
  return new Decimal(p.R).add(p.T).add(p.S).toFixed();
}
