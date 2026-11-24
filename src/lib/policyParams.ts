import type { Policy } from "@/server/policy/schema";

/**
 * Catalogue of every Admin-editable value in a policy: all point values, rates,
 * thresholds, factors and sign-off flags. The Admin policy editor renders this
 * list and the server re-derives it from the base version before applying edits,
 * so only listed paths can ever be changed from the portal. Structure (fields,
 * sections, option keys) stays in the YAML configuration.
 */

export type ParamKind =
  | { type: "decimal"; nullable?: boolean }
  | { type: "int"; nullable?: boolean }
  | { type: "bool" }
  | { type: "enum"; options: { value: string; label: string }[] }
  /** Membership of `member` in the string array at `path`. */
  | { type: "member"; member: string }
  /** Contribution-matrix cell: a factor, or blank to keep a range for Admin/Dean decision. */
  | { type: "matrixCell"; range: string | null };

export type PolicyParam = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  path: (string | number)[];
  kind: ParamKind;
  /** Current value as the editor shows it ("" = blank). */
  value: string;
};

const SIGNOFF = { type: "enum", options: [{ value: "CONFIRMED", label: "Confirmed" }, { value: "PENDING", label: "Pending sign-off" }] } as const satisfies ParamKind;

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export const PARAM_GROUPS = [
  "Eligibility & payment",
  "Designation rates",
  "Teaching",
  "Publications",
  "Publication contribution table",
  "Research activities",
  "Grants",
  "Service",
] as const;

export function editableParameters(p: Policy): PolicyParam[] {
  const out: PolicyParam[] = [];
  const add = (group: (typeof PARAM_GROUPS)[number], label: string, path: (string | number)[], kind: ParamKind, value: unknown, hint?: string) =>
    out.push({ id: path.join(".") + (kind.type === "member" ? `#${kind.member}` : ""), group, label, path, kind, value: kind.type === "bool" ? (value ? "true" : "false") : str(value), hint });

  // ---- Eligibility & payment
  const pa = p.parameters;
  add("Eligibility & payment", "Research rate (₹ per point)", ["parameters", "researchRatePerPoint"], { type: "decimal" }, pa.researchRatePerPoint, "First band of the progressive payment formula.");
  add("Eligibility & payment", "Minimum points — Standard faculty", ["parameters", "minimumPoints", "STANDARD"], { type: "decimal" }, pa.minimumPoints.STANDARD);
  add("Eligibility & payment", "Minimum points — Junior Faculty", ["parameters", "minimumPoints", "JUNIOR"], { type: "decimal" }, pa.minimumPoints.JUNIOR);
  add("Eligibility & payment", "Prorate minimum for part-year service", ["parameters", "prorating", "enabled"], { type: "bool" }, pa.prorating.enabled);
  add(
    "Eligibility & payment",
    "Prorating method",
    ["parameters", "prorating", "basis"],
    { type: "enum", options: [{ value: "PERIOD_DAYS", label: "Days in service ÷ days in the year (joining & exit)" }, { value: "FIXED_DAYS", label: "Legacy: (period end − joining) ÷ fixed days" }] },
    pa.prorating.basis,
  );
  add("Eligibility & payment", "Prorating — sign-off", ["parameters", "prorating", "signoff"], SIGNOFF, pa.prorating.signoff);
  add(
    "Eligibility & payment",
    "Payment rounding",
    ["parameters", "paymentRounding"],
    { type: "enum", options: [{ value: "CEIL_RUPEE", label: "Round up to the next rupee" }, { value: "NEAREST_RUPEE", label: "Nearest rupee" }, { value: "NONE", label: "No rounding" }] },
    pa.paymentRounding,
  );
  add("Eligibility & payment", "Payment rounding — sign-off", ["parameters", "paymentRoundingSignoff"], SIGNOFF, pa.paymentRoundingSignoff);
  if (pa.consultingRevenueShare) {
    add("Eligibility & payment", "Consulting revenue — faculty share (%)", ["parameters", "consultingRevenueShare", "facultyPercent"], { type: "decimal" }, pa.consultingRevenueShare.facultyPercent, "Informational; not part of RTS points.");
    add("Eligibility & payment", "Consulting revenue — institution share (%)", ["parameters", "consultingRevenueShare", "institutionPercent"], { type: "decimal" }, pa.consultingRevenueShare.institutionPercent);
  }

  // ---- Designations
  p.designations.items.forEach((d, i) => {
    add("Designation rates", `${d.label} — ₹ per payable point`, ["designations", "items", i, "pointRate"], { type: "decimal" }, d.pointRate, "Second band of the progressive payment formula.");
    add("Designation rates", `${d.label} — overload ₹ / hour`, ["designations", "items", i, "overloadRatePerHour"], { type: "decimal", nullable: true }, d.overloadRatePerHour);
    add("Designation rates", `${d.label} — CLD ₹ / hour`, ["designations", "items", i, "cldRatePerHour"], { type: "decimal", nullable: true }, d.cldRatePerHour);
  });
  add("Designation rates", "Designation rates — sign-off", ["designations", "pointRateSignoff"], SIGNOFF, p.designations.pointRateSignoff);

  // ---- Teaching
  const t = p.teaching;
  add("Teaching", "Default T points per counted hour", ["teaching", "pointsConversion", "pointsPerHour"], { type: "decimal" }, t.pointsConversion.pointsPerHour, "Applies to core courses and rows without a course type.");
  add("Teaching", "Teaching conversion — sign-off", ["teaching", "pointsConversion", "signoff"], SIGNOFF, t.pointsConversion.signoff);
  t.courseTypes?.forEach((c, i) => {
    add("Teaching", `${c.label} — T points per hour`, ["teaching", "courseTypes", i, "pointsPerHour"], { type: "decimal" }, c.pointsPerHour);
    if (c.minStudentsPerSection !== undefined) add("Teaching", `${c.label} — minimum students per section`, ["teaching", "courseTypes", i, "minStudentsPerSection"], { type: "int" }, c.minStudentsPerSection);
  });
  t.columns.forEach((c, i) => {
    add("Teaching", `${c.label} hours count for T points`, ["teaching", "pointsConversion", "excludedColumns"], { type: "member", member: c.key }, t.pointsConversion.excludedColumns.includes(c.key) ? "false" : "true");
    add("Teaching", `${c.label} hours count towards the teaching cap`, ["teaching", "capExcludedColumns"], { type: "member", member: c.key }, t.capExcludedColumns.includes(c.key) ? "false" : "true");
    if (c.signoff) add("Teaching", `${c.label} column — sign-off`, ["teaching", "columns", i, "signoff"], SIGNOFF, c.signoff);
  });
  p.researchStatuses.forEach((r, i) => {
    add("Teaching", `${r.label} — contractual load (hours)`, ["researchStatuses", i, "contractualLoadHours"], { type: "int" }, r.contractualLoadHours);
    add("Teaching", `${r.label} — teaching cap (hours)`, ["researchStatuses", i, "teachingCapHours"], { type: "int" }, r.teachingCapHours);
  });
  add("Teaching", "New Assistant Professor — contractual load (hours)", ["teaching", "newAssistantProfessor", "contractualLoadHours"], { type: "int" }, t.newAssistantProfessor.contractualLoadHours);
  add("Teaching", "New Assistant Professor — applies for first N years", ["teaching", "newAssistantProfessor", "firstYearsOfService"], { type: "int" }, t.newAssistantProfessor.firstYearsOfService);

  // ---- Publications
  p.publication.classes.forEach((c, i) => add("Publications", `${c.label} — base points`, ["publication", "classes", i, "basePoints"], { type: "decimal" }, c.basePoints));
  add("Publications", "Paid journal — points", ["publication", "paidJournalPoints"], { type: "decimal" }, p.publication.paidJournalPoints);
  add("Publications", "Sole author — factor", ["publication", "soleAuthor", "factor"], { type: "decimal" }, p.publication.soleAuthor.factor);
  add("Publications", "Sole author — sign-off", ["publication", "soleAuthor", "signoff"], SIGNOFF, p.publication.soleAuthor.signoff);
  const lbl = (list: { key: string; label: string }[], k: string) => list.find((x) => x.key === k)?.label ?? k;
  p.publication.contributionMatrix.forEach((c, i) =>
    add(
      "Publication contribution table",
      `${lbl(p.publication.coAuthorCounts, c.coAuthors)} co-author(s) · ${lbl(p.publication.contributions, c.contribution)} · ${lbl(p.publication.affiliationMixes, c.mix)}`,
      ["publication", "contributionMatrix", i],
      { type: "matrixCell", range: c.range ?? null },
      c.factor ?? "",
      c.range ? `Guidelines range ${c.range}: leave blank to keep routing to Admin/Dean.` : undefined,
    ),
  );

  // ---- Research lookup sections
  p.researchSections.forEach((s, si) => {
    if (s.maxScoredEntries !== undefined) add("Research activities", `${s.label} — entries that count (best N)`, ["researchSections", si, "maxScoredEntries"], { type: "int" }, s.maxScoredEntries);
    if (s.calc !== "lookup") return;
    const fi = s.fields.findIndex((f) => f.key === s.lookupField);
    const f = s.fields[fi];
    f?.options?.forEach((o, oi) => {
      add("Research activities", `${s.label} — ${o.label}`, ["researchSections", si, "fields", fi, "options", oi, "points"], { type: "decimal" }, o.points);
      if (o.signoff) add("Research activities", `${s.label} — ${o.label} — sign-off`, ["researchSections", si, "fields", fi, "options", oi, "signoff"], SIGNOFF, o.signoff);
    });
  });

  // ---- Grants
  p.grant.tiers.forEach((g, i) => {
    if (g.below !== undefined) add("Grants", `Tier ${i + 1} — individual share below (₹)`, ["grant", "tiers", i, "below"], { type: "decimal" }, g.below);
    if (g.upToInclusive !== undefined) add("Grants", `Tier ${i + 1} — individual share up to and including (₹)`, ["grant", "tiers", i, "upToInclusive"], { type: "decimal" }, g.upToInclusive);
    add("Grants", `Tier ${i + 1}${g.below === undefined && g.upToInclusive === undefined ? " (above all thresholds)" : ""} — points`, ["grant", "tiers", i, "points"], { type: "decimal" }, g.points);
  });

  // ---- Service
  p.service.roles.forEach((r, i) => {
    add("Service", `${r.label} — points${r.quantity === "COUNT" ? " each" : ""}`, ["service", "roles", i, "points"], { type: "decimal" }, r.points);
    if (r.quantity === "COUNT") add("Service", `${r.label} — maximum counted (blank = no limit)`, ["service", "roles", i, "maxQuantity"], { type: "int", nullable: true }, r.maxQuantity);
    if (r.signoff) add("Service", `${r.label} — sign-off`, ["service", "roles", i, "signoff"], SIGNOFF, r.signoff);
  });
  return out;
}

const DEC = /^\d+(\.\d+)?$/;
const INT = /^\d+$/;

/** Checks one edited value; returns an error message or null. */
export function checkParamValue(param: PolicyParam, raw: string): string | null {
  const v = raw.trim();
  const k = param.kind;
  switch (k.type) {
    case "decimal":
      if (v === "") return k.nullable ? null : "Enter a number.";
      return DEC.test(v) ? null : "Enter a non-negative number (digits and an optional decimal point).";
    case "int":
      if (v === "") return k.nullable ? null : "Enter a whole number.";
      return INT.test(v) && Number(v) > 0 ? null : "Enter a whole number greater than zero.";
    case "bool":
    case "member":
      return v === "true" || v === "false" ? null : "Choose yes or no.";
    case "enum":
      return k.options.some((o) => o.value === v) ? null : "Choose one of the options.";
    case "matrixCell":
      if (v === "") return k.range ? null : "Enter a factor between 0 and 1.";
      return DEC.test(v) && Number(v) <= 1 ? null : "Enter a factor between 0 and 1 (e.g. 0.60).";
  }
}
