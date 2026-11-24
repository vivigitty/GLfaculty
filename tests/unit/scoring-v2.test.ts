import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { readPolicyFile } from "@/server/policy/load";
import type { Policy } from "@/server/policy/schema";
import { eligibilityAndPayment, minimumPoints, scoreSubmission } from "@/server/scoring/engine";
import { validateContent } from "@/server/scoring/validate";
import { categoryRemark, emptyContent, type FacultySnapshot, type SubmissionContent, type TeachingRow } from "@/server/domain/schemas";
import { applyParameterEdits, fitContentToPolicy } from "@/server/services/policies";
import { withoutBlankTeachingRows } from "@/server/services/submissions";
import { editableParameters } from "@/lib/policyParams";

/** Policy 2025-26.v2 — the Nov 2026 points revision plus sign-off decisions. */

let policy: Policy;
let v1: Policy;
const period = { startDate: "2025-04-01", endDate: "2026-03-31" };
const faculty: FacultySnapshot = {
  displayName: "Test",
  email: "t@example.edu",
  designationKey: "ASSISTANT_PROFESSOR",
  facultyCategory: "STANDARD",
  dateOfJoining: "2018-06-01",
  dateOfExit: null,
  researchStatus: "RESEARCH_ACTIVE",
};

beforeAll(async () => {
  policy = await readPolicyFile(path.resolve("config/policy/2025-26.v2.yaml"));
  v1 = await readPolicyFile(path.resolve("config/policy/2025-26.v1.yaml"));
});

const withResearch = (sectionKey: string, values: Record<string, string | boolean | null>, id = "e1"): SubmissionContent => ({ ...emptyContent(), research: [{ id, sectionKey, values }] });
const score = (content: SubmissionContent, f: Partial<FacultySnapshot> = {}, p: Policy = policy) => scoreSubmission({ content, policy: p, faculty: { ...faculty, ...f }, period });
const R = (c: SubmissionContent) => score(c).totals.R;
const svc = (roles: Record<string, string>): SubmissionContent => ({
  ...emptyContent(),
  service: { roles: Object.fromEntries(Object.entries(roles).map(([k, q]) => [k, { quantity: q, description: "" }])), disclosures: {} },
});
const row = (over: Partial<TeachingRow>): TeachingRow => ({ id: "t1", courseName: "Course", courseType: "", sections: "", students: "", feedback: "", hours: {}, notes: "", ...over });

describe("research — revised values", () => {
  it("publication base points unchanged: 200 / 150 / 100 / 50 / 20 / 6", () => {
    const v = (publicationClass: string) => R(withResearch("PUBLICATION", { title: "p", journal: "j", publicationClass, coAuthorCount: "NONE" }));
    expect(["FT50", "ABDC_A_STAR", "ABDC_A", "ABDC_B", "ABDC_C", "SCOPUS_Q3_Q4"].map(v)).toEqual(["200", "150", "100", "50", "20", "6"]);
  });

  it("sole author factor 1.00 is confirmed (no review warning)", () => {
    const s = score(withResearch("PUBLICATION", { title: "p", journal: "j", publicationClass: "FT50", coAuthorCount: "NONE" }));
    expect(s.lines[0]?.reviewRequired).toBe(false);
  });

  it("3+ co-author range cells still go to Admin/Dean review", () => {
    const s = score(withResearch("PUBLICATION", { title: "p", journal: "j", publicationClass: "ABDC_A", coAuthorCount: "THREE_PLUS", contribution: "FIRST_OR_SECOND", affiliationMix: "THREE_PLUS_OTHER_1ST_2ND", equalContributionStated: false }));
    expect(s.totals.R).toBe("0");
    expect(s.warnings.some((w) => w.code === "NEEDS_ADMIN_REVIEW")).toBe(true);
  });

  it("cases: listed international 30, Emerald 10, Indian 2", () => {
    const v = (caseType: string) => R(withResearch("CASE", { title: "c", caseType, repository: "r" }));
    expect([v("INTERNATIONAL"), v("EMERALD"), v("INDIAN")]).toEqual(["30", "10", "2"]);
  });

  it("editorship by journal class: FT50 30, A* 25, A 20, B 10, C 5, other not eligible", () => {
    const v = (journalClass: string) => R(withResearch("EDITORSHIP", { journal: "j", journalClass }));
    expect(["FT50", "ABDC_A_STAR", "ABDC_A", "ABDC_B", "ABDC_C", "OTHER"].map(v)).toEqual(["30", "25", "20", "10", "5", "0"]);
  });

  it("editorship counts only the best 2 journals", () => {
    const content: SubmissionContent = {
      ...emptyContent(),
      research: [
        { id: "a", sectionKey: "EDITORSHIP", values: { journal: "C", journalClass: "ABDC_C" } },
        { id: "b", sectionKey: "EDITORSHIP", values: { journal: "A*", journalClass: "ABDC_A_STAR" } },
        { id: "c", sectionKey: "EDITORSHIP", values: { journal: "B", journalClass: "ABDC_B" } },
      ],
    };
    const s = score(content);
    expect(s.totals.R).toBe("35"); // 25 + 10; the C-class editorship is not scored
    expect(s.lines.find((l) => l.lineId === "R:a")?.explanation).toMatch(/best 2/);
  });

  it("books and chapters: 30 / 15 / 10 / 5 / 2; revised edition 0", () => {
    const v = (bookType: string) => R(withResearch("BOOK", { title: "b", bookType, publisher: "p" }));
    expect(["BOOK_INTERNATIONAL", "BOOK_NATIONAL", "BOOK_EDITING", "CHAPTER_INTERNATIONAL", "CHAPTER_NATIONAL", "REVISED_EDITION"].map(v)).toEqual(["30", "15", "10", "5", "2", "0"]);
  });

  it("PhD guidance (GLIM Chennai): Year 1 paper 3, Year 2 paper 3; committee chair/member retained", () => {
    const v = (role: string) => R(withResearch("DOCTORAL", { student: "s", role }));
    expect(["PAPER_GUIDANCE_Y1", "PAPER_GUIDANCE_Y2", "GL_CHAIR", "GL_MEMBER", "OUTSIDE_EXAMINER"].map(v)).toEqual(["3", "3", "25", "15", "0"]);
  });

  it("patent registration = 15", () => {
    expect(R(withResearch("PATENT", { title: "p", activity: "PATENT_REGISTRATION", number: "1" }))).toBe("15");
  });

  it("conference papers and track chairs are Nil; R&R and reviews are zero", () => {
    expect(R(withResearch("CONFERENCE", { title: "x", conference: "c", conferenceType: "TRACK_CHAIR_INTERNATIONAL" }))).toBe("0");
    expect(R(withResearch("CONFERENCE", { title: "x", conference: "c", conferenceType: "AREA_INTERNATIONAL" }))).toBe("0");
    expect(R(withResearch("REVISE_RESUBMIT", { title: "x", journal: "j" }))).toBe("0");
    expect(R(withResearch("PAPER_REVIEW", { journal: "j" }))).toBe("0");
  });

  it("popular press scores 0 and is flagged as pending sign-off", () => {
    const s = score(withResearch("POPULAR_PRESS", { title: "a", outlet: "Mint", outletType: "MAINSTREAM" }));
    expect(s.totals.R).toBe("0");
    expect(s.warnings.some((w) => w.code === "VALUE_PENDING_SIGNOFF")).toBe(true);
    expect(s.lines[0]?.reviewRequired).toBe(true);
  });
});

describe("grants — revised tiers on the individual equal share", () => {
  const g = (total: string, n = "1") => R(withResearch("GRANT", { title: "g", grantType: "GOVERNMENT_SPONSORED", sponsor: "s", totalAmount: total, participatingFaculty: n }));
  it("below ₹50,000 → 0", () => expect(g("49999.99")).toBe("0"));
  it("exactly ₹50,000 → 5", () => expect(g("50000")).toBe("5"));
  it("exactly ₹2,00,000 → 5", () => expect(g("200000")).toBe("5"));
  it("just above ₹2,00,000 → 10", () => expect(g("200000.01")).toBe("10"));
  it("split equally first: ₹6,00,000 ÷ 3 = ₹2,00,000 → 5; ₹6,00,000 ÷ 2 → 10", () => {
    expect(g("600000", "3")).toBe("5");
    expect(g("600000", "2")).toBe("10");
  });
});

describe("service — revised values", () => {
  it("programme directors and director roles", () => {
    const s = (k: string) => score(svc({ [k]: "1" })).totals.S;
    expect(["DIR_PGPM", "DIR_PGDM", "DIR_PGXPM", "DIR_FPM", "DIR_RESEARCH", "DIR_ACCREDITATION"].map(s)).toEqual(["40", "40", "20", "20", "10", "20"]);
  });
  it("Centre of Excellence 10, Area Chair 10, Disciplinary Action Committee 10", () => {
    const s = (k: string) => score(svc({ [k]: "1" })).totals.S;
    expect(["CENTRE_EXCELLENCE", "AREA_CHAIR", "DISCIPLINARY_COMMITTEE"].map(s)).toEqual(["10", "10", "10"]);
  });
  it("conducting conferences for GLIM Chennai: international 40, national 30 each", () => {
    expect(score(svc({ CONF_CONDUCT_INTERNATIONAL: "1", CONF_CONDUCT_NATIONAL: "2" })).totals.S).toBe("100");
  });
  it("other club / committee memberships score 0", () => {
    expect(score(svc({ COMMITTEE_WORK: "4" })).totals.S).toBe("0");
  });
  it("empirical study guidance 0.3 per group, max 10 groups; internship 0.3 per student", () => {
    const e = score(svc({ EMPIRICAL_GUIDANCE: "12" }));
    expect(e.totals.S).toBe("3");
    expect(e.lines[0]?.explanation).toMatch(/capped/);
    expect(score(svc({ INTERNSHIP_GUIDANCE: "4" })).totals.S).toBe("1.2");
  });
  it("concurrent roles stack", () => {
    expect(score(svc({ DIR_PGPM: "1", DIR_FPM: "1", AREA_CHAIR: "1" })).totals.S).toBe("70");
  });
  it("PGP Flex director is scored like PGXPM but flagged pending", () => {
    const s = score(svc({ DIR_PGP_FLEX: "1" }));
    expect(s.totals.S).toBe("20");
    expect(s.warnings.some((w) => w.code === "VALUE_PENDING_SIGNOFF")).toBe(true);
  });
  it("removed v1 roles are rejected by validation", () => {
    expect(validateContent(svc({ CONFERENCE_COORDINATION: "1" }), policy, "draft").length).toBeGreaterThan(0);
  });
});

describe("teaching", () => {
  const T = (r: TeachingRow, f: Partial<FacultySnapshot> = {}) => score({ ...emptyContent(), teaching: [r] }, f);
  it("core classes: 1 point per hour; GLPSS and FPM count like other non-CLD hours", () => {
    expect(T(row({ courseType: "CORE", hours: { pgpm: "20", glpss: "10", fpm: "5" } })).totals.T).toBe("35");
  });
  it("CLD earns no points and has no separate compensation", () => {
    const s = T(row({ hours: { cld: "30", pgpm: "10" } }));
    expect(s.totals.T).toBe("10");
    expect(s.teachingInfo.cldCompensation).toBeNull();
    expect(s.warnings.some((w) => w.code === "CLD_TREATMENT_PENDING")).toBe(false);
  });
  it("large elective (≥100 students per section) earns 1.25 per hour, flagged for Admin verification", () => {
    const s = T(row({ courseType: "LARGE_ELECTIVE", sections: "2", students: "220", hours: { pgdm2: "40" } }));
    expect(s.totals.T).toBe("50");
    expect(s.lines[0]?.reviewRequired).toBe(true);
  });
  it("large elective below 100 per section falls back to 1 per hour with a warning", () => {
    const s = T(row({ courseType: "LARGE_ELECTIVE", sections: "2", students: "150", hours: { pgdm2: "40" } }));
    expect(s.totals.T).toBe("40");
    expect(s.warnings.some((w) => w.code === "COURSE_TYPE_NOT_MET")).toBe(true);
  });
  it("OPGDM counts for T, not towards the cap, and is flagged pending", () => {
    const s = T(row({ hours: { opgdm: "30", pgpm: "10" } }));
    expect(s.totals.T).toBe("40");
    expect(s.teachingInfo.hoursCountedForCap).toBe("10");
    expect(s.warnings.some((w) => w.code === "TEACHING_COLUMN_PENDING")).toBe(true);
  });
  it("teaching conversion is confirmed (no pending warning)", () => {
    expect(T(row({ hours: { pgpm: "10" } })).warnings.some((w) => w.code === "TEACHING_CONVERSION_PENDING")).toBe(false);
  });
  it("an unknown course type is a validation error", () => {
    expect(validateContent({ ...emptyContent(), teaching: [row({ courseType: "Regular", hours: { pgpm: "1" } })] }, policy, "draft").some((e) => e.path.endsWith("courseType"))).toBe(true);
  });
  it("blank bulk-added rows are dropped at submission", () => {
    const c = { ...emptyContent(), teaching: [row({ hours: { pgpm: "5" } }), row({ id: "t2", courseName: "" }), row({ id: "t3", courseName: "", hours: { pgpm: " " } })] };
    expect(withoutBlankTeachingRows(c).teaching.map((r) => r.id)).toEqual(["t1"]);
  });
});

describe("eligibility — days in service ÷ days in the year", () => {
  const min = (f: Partial<FacultySnapshot>, p = period) => minimumPoints(policy, { ...faculty, ...f }, p).minimum.toFixed();
  it("full year → 200; Junior → 30", () => {
    expect(min({})).toBe("200");
    expect(min({ facultyCategory: "JUNIOR" })).toBe("30");
  });
  it("joining on the first day of the year is a full year (200)", () => {
    expect(min({ dateOfJoining: "2025-04-01" })).toBe("200");
  });
  it("joining mid-year: 1 Oct 2025 → 182/365 of 200", () => {
    const r = minimumPoints(policy, { ...faculty, dateOfJoining: "2025-10-01" }, period);
    expect(r.factor?.mul(365).toFixed()).toBe("182");
  });
  it("exiting mid-year: last day 30 Sep 2025 → 183/365 of 200", () => {
    const r = minimumPoints(policy, { ...faculty, dateOfExit: "2025-09-30" }, period);
    expect(r.factor?.mul(365).toFixed()).toBe("183");
    expect(r.warnings[0]).toMatch(/exit/);
  });
  it("joining and exiting in the same year", () => {
    const r = minimumPoints(policy, { ...faculty, dateOfJoining: "2025-07-01", dateOfExit: "2025-12-31" }, period);
    expect(r.factor?.mul(365).toFixed()).toBe("184");
  });
  it("exit on the last day of the year → full minimum", () => {
    expect(min({ dateOfExit: "2026-03-31" })).toBe("200");
  });
  it("leap-year period uses 366 days", () => {
    const leap = { startDate: "2027-04-01", endDate: "2028-03-31" };
    const r = minimumPoints(policy, { ...faculty, dateOfJoining: "2027-10-01" }, leap);
    expect(r.factor?.mul(366).toFixed()).toBe("183");
  });
  it("not in service during the year → minimum 0 with a warning", () => {
    expect(min({ dateOfExit: "2025-03-31" })).toBe("0");
  });
});

describe("payment rounding — ceiling to the next rupee", () => {
  it("rounds up any fraction of a rupee", () => {
    // P = 0.33333 ≤ R → 0.33333 × 7000 = 2333.31 → 2334
    const r = eligibilityAndPayment({ R: "20", T: "180.33333", S: "0" }, policy, faculty, period);
    expect(r.paymentExact).toBe("2333.31");
    expect(r.payment).toBe("2334");
  });
  it("whole amounts are unchanged; spec example still 14,60,000", () => {
    expect(eligibilityAndPayment({ R: "80", T: "300", S: "50" }, policy, faculty, period).payment).toBe("1460000");
  });
});

describe("Admin policy editor", () => {
  const param = (p: Policy, pred: (label: string) => boolean) => {
    const x = editableParameters(p).find((q) => pred(q.label));
    if (!x) throw new Error("param not found");
    return x;
  };

  it("exposes every point value and rate", () => {
    const ids = editableParameters(policy).map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("parameters.researchRatePerPoint");
    expect(ids.filter((i) => i.startsWith("service.roles.") && i.endsWith(".points"))).toHaveLength(policy.service.roles.length);
    expect(ids.filter((i) => i.startsWith("designations.items.") && i.endsWith(".pointRate"))).toHaveLength(policy.designations.items.length);
    expect(ids.filter((i) => i.startsWith("grant.tiers.") && i.endsWith(".points"))).toHaveLength(policy.grant.tiers.length);
  });

  it("applies edits to a copy, records a diff, and the engine uses the new values", () => {
    const area = param(policy, (l) => l.startsWith("Area Chair — points"));
    const rate = param(policy, (l) => l.startsWith("Research rate"));
    const { raw, changes, errors } = applyParameterEdits(policy, { [area.id]: "12", [rate.id]: "7500" });
    expect(errors).toEqual([]);
    expect(changes.map((c) => [c.before, c.after])).toEqual([["10", "12"], ["7000", "7500"]]);
    expect(policy.service.roles.find((r) => r.key === "AREA_CHAIR")?.points).toBe("10"); // base untouched
    const p2 = { ...(raw as Policy) };
    expect(score(svc({ AREA_CHAIR: "1" }), {}, p2).totals.S).toBe("12");
    expect(eligibilityAndPayment({ R: "100", T: "130", S: "0" }, p2, faculty, period).payment).toBe("225000");
  });

  it("rejects paths that are not editable and invalid values", () => {
    const area = param(policy, (l) => l.startsWith("Area Chair — points"));
    const r = applyParameterEdits(policy, { "service.roles.0.label": "x", [area.id]: "-1" });
    expect(r.errors.map((e) => e.path)).toEqual(["edits.service.roles.0.label", `edits.${area.id}`]);
  });

  it("a range cell can be fixed to a factor, and a column can be taken out of T points", () => {
    const cell = editableParameters(policy).find((p) => p.kind.type === "matrixCell" && p.kind.range === "50–70%");
    const opgdm = editableParameters(policy).find((p) => p.id === "teaching.pointsConversion.excludedColumns#opgdm");
    if (!cell || !opgdm) throw new Error("missing params");
    const { raw, errors } = applyParameterEdits(policy, { [cell.id]: "0.60", [opgdm.id]: "false" });
    expect(errors).toEqual([]);
    const p2 = raw as Policy;
    expect(score(withResearch("PUBLICATION", { title: "p", journal: "j", publicationClass: "ABDC_A", coAuthorCount: "THREE_PLUS", contribution: "FIRST_OR_SECOND", affiliationMix: "THREE_PLUS_OTHER_1ST_2ND" }), {}, p2).totals.R).toBe("60");
    expect(score({ ...emptyContent(), teaching: [row({ hours: { opgdm: "30", pgpm: "10" } })] }, {}, p2).totals.T).toBe("10");
  });

  it("marking a value confirmed clears its review warning", () => {
    const flex = param(policy, (l) => l.startsWith("Programme Director — PGP Flex — sign-off"));
    const { raw } = applyParameterEdits(policy, { [flex.id]: "CONFIRMED" });
    expect(score(svc({ DIR_PGP_FLEX: "1" }), {}, raw as Policy).warnings).toEqual([]);
  });
});

describe("drafts moving from v1 to v2", () => {
  it("values v2 no longer has are removed and reported; teaching hours are noted on the row", () => {
    const draft: SubmissionContent = {
      teaching: [row({ hours: { pgpm: "10", others: "6" } })],
      research: [{ id: "e", sectionKey: "EDITORSHIP", values: { journal: "J", frequency: "BIANNUAL", role: null, startDate: null } }],
      service: { roles: { CONFERENCE_COORDINATION: { quantity: "1", description: "" }, AREA_CHAIR: { quantity: "1", description: "" } }, disclosures: { POPULAR_MEDIA_A: "2" } },
      facultyNotes: "",
    };
    const { content, removed } = fitContentToPolicy(draft, policy);
    expect(removed).toHaveLength(4);
    expect(content.teaching[0]?.hours).toEqual({ pgpm: "10" });
    expect(content.teaching[0]?.notes).toMatch(/others: 6 h/);
    expect(Object.keys(content.service.roles)).toEqual(["AREA_CHAIR"]);
    expect(validateContent(content, policy, "draft")).toEqual([]);
    expect(v1.version).toBe("2025-26.v1");
  });
});

describe("category remarks", () => {
  it("combines the Admin's category remark with line-override reasons", () => {
    const sub = {
      categoryRemarks: { R: "Case repository not verified" },
      lineReviews: { "R:x": { status: "VERIFIED" as const, note: "", approvedPoints: "0", reason: "Not a new book", updatedAt: "2026-11-24T00:00:00.000Z" } },
      submittedScore: null,
    };
    expect(categoryRemark(sub, "R")).toBe("Case repository not verified; R:x: Not a new book");
    expect(categoryRemark(sub, "S")).toBe("");
  });
});
