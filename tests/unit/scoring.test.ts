import { beforeAll, describe, expect, it } from "vitest";
import path from "node:path";
import { readPolicyFile, parsePolicy } from "@/server/policy/load";
import type { Policy } from "@/server/policy/schema";
import { eligibilityAndPayment, minimumPoints, scoreSubmission } from "@/server/scoring/engine";
import { validateContent } from "@/server/scoring/validate";
import { emptyContent, type FacultySnapshot, type SubmissionContent } from "@/server/domain/schemas";

let policy: Policy;
const period = { startDate: "2025-04-01", endDate: "2026-03-31" };
const faculty: FacultySnapshot = {
  displayName: "Test",
  email: "t@example.edu",
  designationKey: "ASSISTANT_PROFESSOR",
  facultyCategory: "STANDARD",
  dateOfJoining: "2018-06-01",
  researchStatus: "RESEARCH_ACTIVE",
  dateOfExit: null,
};

beforeAll(async () => {
  policy = await readPolicyFile(path.resolve("config/policy/2025-26.v1.yaml"));
});

function withResearch(sectionKey: string, values: Record<string, string | boolean | null>): SubmissionContent {
  return { ...emptyContent(), research: [{ id: "e1", sectionKey, values }] };
}
function score(content: SubmissionContent, f: Partial<FacultySnapshot> = {}) {
  return scoreSubmission({ content, policy, faculty: { ...faculty, ...f }, period });
}
const R = (c: SubmissionContent) => score(c).totals.R;

describe("research scoring", () => {
  it("Indian case = 2, international case = 30", () => {
    expect(R(withResearch("CASE", { title: "x", caseType: "INDIAN", repository: "IIMB" }))).toBe("2");
    expect(R(withResearch("CASE", { title: "x", caseType: "INTERNATIONAL", repository: "HBP" }))).toBe("30");
  });

  it("patent registration = 15", () => {
    expect(R(withResearch("PATENT", { title: "p", activity: "PATENT_REGISTRATION", number: "1" }))).toBe("15");
  });

  it("editorship: biannual 10, quarterly 15, monthly not eligible", () => {
    expect(R(withResearch("EDITORSHIP", { journal: "j", frequency: "BIANNUAL" }))).toBe("10");
    expect(R(withResearch("EDITORSHIP", { journal: "j", frequency: "QUARTERLY" }))).toBe("15");
    const monthly = score(withResearch("EDITORSHIP", { journal: "j", frequency: "MONTHLY" }));
    expect(monthly.totals.R).toBe("0");
    expect(monthly.lines[0]?.explanation).toMatch(/not eligible/);
  });

  it("books and chapters use Guideline values", () => {
    const v = (bookType: string) => R(withResearch("BOOK", { title: "b", bookType, publisher: "p" }));
    expect([v("BOOK_INTERNATIONAL"), v("BOOK_NATIONAL"), v("BOOK_EDITING"), v("CHAPTER_INTERNATIONAL"), v("CHAPTER_NATIONAL"), v("REVISED_EDITION")]).toEqual(["30", "15", "10", "5", "2", "0"]);
  });

  it("doctoral committee chair 25, member 15, external examiner 0", () => {
    const v = (role: string) => R(withResearch("DOCTORAL", { student: "s", role }));
    expect([v("GL_CHAIR"), v("GL_MEMBER"), v("OUTSIDE_EXAMINER")]).toEqual(["25", "15", "0"]);
  });

  it("conference, reviewing and R&R are zero", () => {
    expect(R(withResearch("CONFERENCE", { title: "t", conference: "c", conferenceType: "AREA_INTERNATIONAL" }))).toBe("0");
    expect(R(withResearch("PAPER_REVIEW", { journal: "j", reviewCategory: "ABDC_A_STAR" }))).toBe("0");
    expect(R(withResearch("REVISE_RESUBMIT", { title: "t", journal: "j", publicationClass: "FT50" }))).toBe("0");
  });

  describe("grants: equal split, tier on individual share", () => {
    const g = (totalAmount: string, participatingFaculty = "1") =>
      R(withResearch("GRANT", { title: "g", grantType: "EXTERNAL_RESEARCH", sponsor: "s", totalAmount, participatingFaculty }));
    it("boundaries around ₹1 lakh", () => {
      expect(g("99999.99")).toBe("3");
      expect(g("100000")).toBe("5");
      expect(g("100000.01")).toBe("5");
    });
    it("boundaries around ₹3 lakh", () => {
      expect(g("299999.99")).toBe("5");
      expect(g("300000")).toBe("5");
      expect(g("300000.01")).toBe("10");
    });
    it("₹6 lakh shared by 3 faculty → ₹2 lakh share → 5", () => {
      expect(g("600000", "3")).toBe("5");
    });
    it("₹4 lakh shared by 2 → ₹2 lakh → 5 (not 10 on the total)", () => {
      expect(g("400000", "2")).toBe("5");
    });
  });

  describe("publications", () => {
    const pub = (v: Record<string, string | boolean | null>) =>
      score(withResearch("PUBLICATION", { title: "p", journal: "j", publicationClass: "ABDC_B", ...v }));

    it("uses Guidelines base points, never Faculty Sheet Sheet3 multipliers", () => {
      const r = pub({ coAuthorCount: "TWO", contribution: "FIRST", affiliationMix: "TWO_OTHER_2ND" });
      expect(r.totals.R).toBe("35"); // 50 × 0.70
      expect(r.lines[0]?.reviewRequired).toBe(false);
    });

    it("FT50 with all-external co-author, 1st author = 200", () => {
      const r = score(withResearch("PUBLICATION", { title: "p", journal: "j", publicationClass: "FT50", coAuthorCount: "ONE", contribution: "FIRST", affiliationMix: "ALL_OTHER" }));
      expect(r.totals.R).toBe("200");
    });

    it("range-valued cells route to Admin review with zero provisional points", () => {
      const r = pub({ coAuthorCount: "THREE_PLUS", contribution: "FIRST_OR_SECOND", affiliationMix: "THREE_PLUS_OTHER_1ST_2ND" });
      expect(r.totals.R).toBe("0");
      expect(r.lines[0]?.reviewRequired).toBe(true);
      expect(r.warnings.some((w) => w.code === "NEEDS_ADMIN_REVIEW")).toBe(true);
    });

    it("unlisted combinations route to Admin review", () => {
      const r = pub({ coAuthorCount: "TWO", contribution: "FIRST", affiliationMix: "TWO_OTHER_1ST" });
      expect(r.totals.R).toBe("0");
      expect(r.warnings[0]?.code).toBe("NEEDS_ADMIN_REVIEW");
    });

    it("paid journal scores zero and is flagged", () => {
      const r = pub({ paidJournal: true, coAuthorCount: "NONE" });
      expect(r.totals.R).toBe("0");
      expect(r.warnings[0]?.code).toBe("PAID_JOURNAL");
    });

    it("equal contribution without explicit statement is flagged", () => {
      const r = pub({ coAuthorCount: "ONE", contribution: "EQUAL", affiliationMix: "ALL_GL" });
      expect(r.totals.R).toBe("25");
      expect(r.lines[0]?.reviewRequired).toBe(true);
    });

    it("fractional factors stay exact (50 × 0.33)", () => {
      const r = pub({ coAuthorCount: "TWO", contribution: "EQUAL", affiliationMix: "ALL_GL", equalContributionStated: true });
      expect(r.totals.R).toBe("16.5");
    });
  });
});

describe("service scoring", () => {
  const svc = (roles: Record<string, string>) =>
    score({ ...emptyContent(), service: { roles: Object.fromEntries(Object.entries(roles).map(([k, q]) => [k, { quantity: q, description: "" }])), disclosures: {} } }).totals.S;

  it("confirmed service values", () => {
    expect(svc({ DIR_PGPM: "1" })).toBe("25");
    expect(svc({ DIR_PGDM: "1" })).toBe("25");
    expect(svc({ DIR_PGP_FLEX: "1" })).toBe("10");
    expect(svc({ DIR_PGXPM: "1" })).toBe("10");
    expect(svc({ DIR_RESEARCH: "1", DIR_ACCREDITATION: "1" })).toBe("40");
    expect(svc({ RECRUITMENT_CHAIR: "1" })).toBe("10");
    expect(svc({ CENTRE_EXCELLENCE: "1" })).toBe("7");
    expect(svc({ COMMITTEE_WORK: "3" })).toBe("9");
    expect(svc({ CONFERENCE_COORDINATION: "1" })).toBe("10");
    expect(svc({ ADMISSIONS: "1" })).toBe("20");
    expect(svc({ AREA_CHAIR: "1" })).toBe("7");
  });

  it("empirical and internship guidance score zero", () => {
    expect(svc({ EMPIRICAL_GUIDANCE: "4", INTERNSHIP_GUIDANCE: "9" })).toBe("0");
  });

  it("Disciplinary Committee cannot be entered under v1", () => {
    const content: SubmissionContent = { ...emptyContent(), service: { roles: { DISCIPLINARY_COMMITTEE: { quantity: "1", description: "" } }, disclosures: {} } };
    expect(validateContent(content, policy, "draft").some((e) => e.path.includes("DISCIPLINARY"))).toBe(true);
    expect(score(content).totals.S).toBe("0");
  });

  it("a Disciplinary Committee role is configurable again (Nov 2026 revision lifted the v1 guardrail)", () => {
    const raw = JSON.parse(JSON.stringify(policy));
    raw.service.roles.push({ key: "DISCIPLINARY_COMMITTEE", group: "x", label: "Disciplinary Committee", points: "10", quantity: "FLAG" });
    expect(parsePolicy(raw).service.roles.some((r) => r.key === "DISCIPLINARY_COMMITTEE")).toBe(true);
  });
});

describe("teaching", () => {
  it("counts non-CLD hours as provisional T and flags pending sign-off", () => {
    const content: SubmissionContent = {
      ...emptyContent(),
      teaching: [
        { id: "c1", courseName: "A", courseType: "", sections: "1", students: "30", feedback: "", hours: { pgpm: "20", cld: "12" }, notes: "" },
        { id: "c2", courseName: "B", courseType: "", sections: "1", students: "30", feedback: "4.5", hours: { pgdm1: "120.5" }, notes: "" },
      ],
    };
    const r = score(content);
    expect(r.totals.T).toBe("140.5");
    expect(r.teachingInfo.cldHours).toBe("12");
    expect(r.teachingInfo.cldCompensation).toBe("84000");
    expect(r.warnings.map((w) => w.code)).toContain("TEACHING_CONVERSION_PENDING");
    expect(r.warnings.map((w) => w.code)).toContain("CLD_TREATMENT_PENDING");
  });

  it("warns when the cap is exceeded but does not alter points", () => {
    const content: SubmissionContent = {
      ...emptyContent(),
      teaching: [{ id: "c1", courseName: "A", courseType: "", sections: "", students: "", feedback: "", hours: { pgpm: "230" }, notes: "" }],
    };
    const r = score(content);
    expect(r.totals.T).toBe("230");
    expect(r.warnings.map((w) => w.code)).toContain("TEACHING_CAP_EXCEEDED");
  });
});

describe("eligibility", () => {
  const pts = (earned: string) => ({ R: "0", T: earned, S: "0" });
  it("standard minimum 200", () => {
    expect(eligibilityAndPayment(pts("199"), policy, faculty, period).pointsPayable).toBe("0");
    expect(eligibilityAndPayment(pts("200"), policy, faculty, period).pointsPayable).toBe("0");
    expect(eligibilityAndPayment(pts("250"), policy, faculty, period).pointsPayable).toBe("50");
  });
  it("Junior Faculty minimum 30", () => {
    const jf = { ...faculty, facultyCategory: "JUNIOR" as const, designationKey: "JUNIOR_FACULTY" };
    expect(eligibilityAndPayment(pts("29"), policy, jf, period).pointsPayable).toBe("0");
    expect(eligibilityAndPayment(pts("30"), policy, jf, period).pointsPayable).toBe("0");
    expect(eligibilityAndPayment(pts("31"), policy, jf, period).pointsPayable).toBe("1");
  });
  it("new-faculty prorating at exact boundaries (workbook convention)", () => {
    // Joined exactly 365 days before period end → full year.
    expect(minimumPoints(policy, { facultyCategory: "STANDARD", dateOfJoining: "2025-03-31" }, period).minimum.toFixed()).toBe("200");
    // Joined on the period start: 364 / 365 under the workbook's END_EXCLUSIVE convention.
    const m = minimumPoints(policy, { facultyCategory: "STANDARD", dateOfJoining: "2025-04-01" }, period);
    expect(m.minimum.toDecimalPlaces(4).toFixed()).toBe("199.4521");
    expect(m.warnings[0]).toMatch(/pending sign-off/);
    // Joined 1 Oct: 181 days ÷ 365 × 200.
    expect(minimumPoints(policy, { facultyCategory: "STANDARD", dateOfJoining: "2025-10-01" }, period).minimum.toDecimalPlaces(2).toFixed()).toBe("99.18");
    // Joining on period end → zero minimum.
    expect(minimumPoints(policy, { facultyCategory: "STANDARD", dateOfJoining: "2026-03-31" }, period).minimum.toFixed()).toBe("0");
  });
  it("END_INCLUSIVE convention is configurable", () => {
    const p2 = parsePolicy({ ...policy, parameters: { ...policy.parameters, prorating: { ...policy.parameters.prorating, dayCount: "END_INCLUSIVE" } } });
    expect(minimumPoints(p2, { facultyCategory: "STANDARD", dateOfJoining: "2025-04-01" }, period).minimum.toFixed()).toBe("200");
  });
});

describe("progressive payment formula", () => {
  const pay = (p: { R: string; T: string; S: string }, designationKey = "ASSISTANT_PROFESSOR") =>
    eligibilityAndPayment(p, policy, { ...faculty, designationKey }, period);

  it("P = 0 → no payment", () => {
    expect(pay({ R: "50", T: "100", S: "50" }).payment).toBe("0");
  });
  it("P < R → P × research rate", () => {
    const r = pay({ R: "100", T: "130", S: "0" }); // P = 30
    expect(r.pointsPayable).toBe("30");
    expect(r.payment).toBe("210000");
  });
  it("P = R → P × research rate", () => {
    const r = pay({ R: "50", T: "200", S: "0" }); // P = 50
    expect(r.payment).toBe("350000");
  });
  it("P > R → R × research rate + (P − R) × designation rate (spec example)", () => {
    const r = pay({ R: "80", T: "300", S: "50" }); // earned 430, P 230
    expect(r.pointsPayable).toBe("230");
    expect(r.payment).toBe("1460000");
  });
  it("R = 0 → whole P at designation rate", () => {
    expect(pay({ R: "0", T: "210", S: "0" }).payment).toBe("60000");
  });
  it("fractional points stay exact until final rounding", () => {
    const r = pay({ R: "16.5", T: "200", S: "0.25" }); // P = 16.75 > R
    expect(r.paymentExact).toBe("117000");
    const r2 = pay({ R: "20", T: "180.333", S: "0" }); // P = 0.333 ≤ R
    expect(r2.paymentExact).toBe("2331");
  });
  it("research rate is read from configuration", () => {
    const p2 = parsePolicy({ ...policy, parameters: { ...policy.parameters, researchRatePerPoint: "8000" } });
    expect(eligibilityAndPayment({ R: "100", T: "130", S: "0" }, p2, faculty, period).payment).toBe("240000");
  });
});

describe("validation", () => {
  it("submit mode requires mandatory research fields", () => {
    const errs = validateContent(withResearch("CASE", { title: "", caseType: null }), policy, "submit");
    expect(errs.map((e) => e.path)).toEqual(expect.arrayContaining(["research.e1.title", "research.e1.caseType", "research.e1.repository"]));
  });
  it("rejects negative hours", () => {
    const c: SubmissionContent = { ...emptyContent(), teaching: [{ id: "c", courseName: "A", courseType: "", sections: "", students: "", feedback: "", hours: { pgpm: "-3" }, notes: "" }] };
    expect(validateContent(c, policy, "draft")[0]?.message).toMatch(/non-negative/);
  });
});
