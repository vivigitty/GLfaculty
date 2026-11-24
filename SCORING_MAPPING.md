# RTS Scoring and Policy Mapping
**Version:** 2.2  
**Policy sources:** Guidelines workbook plus owner-confirmed decisions. The Faculty Sheet is treated as a legacy data-entry/formula reference only where it does not conflict with the Guidelines or owner decisions. The Faculty Sheet's `Sheet3` multiplier table is not authoritative.

## 0. Nov 2026 points revision — supersedes conflicting values below

The owner's `Updated-RTS points_proposed revisions.xlsx` is the **final source of truth for point
values**, together with the sign-off comments on the mock-up workbook. Implemented in
`config/policy/2025-26.v2.yaml`; every value is editable per academic year in Admin → Policy.
Where this section conflicts with §3–§14, this section wins. Open items: `docs/OPEN_QUESTIONS.md`.

| Area | v2 value |
|---|---|
| Teaching | Core 1 point / non-CLD hour; elective with ≥ 100 students in one section, evaluated by faculty, 1.25 / hour; FPM hours at the normal rate; GLPSS counts like other non-CLD hours; CLD: no points, no calculation, excluded from payables |
| Publications | FT50 / UT Dallas 200; A* 150; A / Scopus top 4 percentile 100; B / rest of Scopus Q1 50; C / Scopus Q2 20; Scopus Q3/Q4 6. Co-author count excludes the submitting faculty; ranges → Admin/Dean |
| Cases | HBSP, INSEAD, IMD, Darden, HKUST, Wharton, Stanford, Ivey 30; Emerald 10; Indian 2 (retained) |
| Books | International 30; National 15; editing 10; chapter international 5; chapter national 2 |
| Grants (individual equal share) | ₹50,000–₹2,00,000 → 5; > ₹2,00,000 → 10; < ₹50,000 → 0 |
| Editorial board (best 2 journals) | FT50 30; A* 25; A 20; B 10; C 5 (replaces biannual 10 / quarterly 15) |
| PhD guidance (GLIM Chennai) | Year 1 paper 3; Year 2 paper 3 (committee Chair 25 / Member 15 retained) |
| Conferences / track chairs | Nil |
| Conducting conferences for GLIM Chennai | International 40; national 30 (per conference; Service — see open question 5) |
| Service | Programme Director PGPM / PGDM 40; PGXPM / FPM 20; Director Research 10; Director Accreditations 20; Chairperson Centre of Excellence 10; Area Chair 10; **Member Disciplinary Action Committee 10** (re-introduced); other club / committee memberships 0; empirical study guidance 0.3 per group (max 10); internship guidance 0.3 per student |
| Consulting | 70 : 30 faculty : institution after expenses — informational, not RTS points |
| Eligibility | 200 / 30; prorated by days in service ÷ days in the year for new **and exiting** faculty |
| Payment | Progressive formula unchanged; final amount rounded **up** to the next rupee |

## 1. Policy precedence

1. Explicit owner-confirmed decisions in this project.
2. `Copy of RTS-Guidelines-Policies_2023_final (1).xlsx`.
3. `RTS Final Draft 25-06-2026.xlsx` for consolidated Admin layout and historical payment columns.
4. `RTS_25-26 - April2026_Prof 1.xlsm` for faculty form fields and legacy calculation clues only.

Do not import legacy spreadsheet formulas as policy without validation.

## 2. Output metrics

Maintain distinct values:
- `R` — Research points.
- `T` — Teaching points / qualifying teaching contribution.
- `S` — Service points.
- `earnedPoints = R + T + S`.
- `minimumPoints` — standard or Junior Faculty threshold, prorated only for eligible new faculty as confirmed.
- `pointsPayable` — earned points above minimum, floored at zero.
- `paymentAmount` — calculated using the progressive payment formula below.
- `paidAmount`, `correctedAmount`, `differentialAmount` — Admin finance values; do not confuse them with points.

For a standard faculty member:
`minimumPoints = 200`.

For Junior Faculty:
`minimumPoints = 30`.

For a new faculty member, prorate the applicable minimum based on service duration in the reporting period. The exact partial-month convention remains a configuration/sign-off item.

## 3. Research journal publications

### 3.1 Base points from Guidelines — Publications sheet

| Publication class | Base points |
|---|---:|
| FT50 Journal | 200 |
| Non-FT50 ABDC A* | 150 |
| ABDC A / Scopus Top 2% | 100 |
| ABDC B / Scopus Q1 (not Top 2%) | 50 |
| ABDC C / Scopus Q2 | 20 |
| Non-ABDC Scopus indexed journal Q3/Q4 | 6 |

Policy notes:
- Non-ABDC Scopus journals must be peer-reviewed; the Dean may request reviews.
- Zero points for paid journals.
- In cases of doubt, the Dean may request reviews even for ABDC journals because the current list may contain anomalies.
- Publication class must be recorded as at the relevant policy date and be reviewable by Admin.
- Do not substitute the Faculty Sheet's category labels or `Sheet3` formulas for this base-point table.

### 3.2 Co-authorship / contribution multipliers

The Guidelines Publications sheet contains a contribution table. The application must store the policy table as structured configuration and apply the relevant multiplier to the base points. Do not copy the Faculty Sheet's `Sheet3` multiplier grid.

Guideline table structure:
- Co-author count: One; Two; Three or more.
- Faculty contribution: Equal; 1st; 2nd; 3rd.
- Affiliation mix: all co-authors from Great Lakes; all from other institutions; mixed authorship for two co-authors (one Great Lakes); mixed authorship for three or more co-authors (one or two Great Lakes).
- The mixed three-or-more table includes ranges in some cells, e.g. `50-70%`, `50-80%`, and `30-40%`. These are ranges, not single deterministic values.

Exact values shown in the Guidelines table:

| Co-author count | Faculty contribution | All GL | All other institutions | Two authors: other 1st | Two authors: other 2nd | Two authors: other 3rd | 3+ authors: other 1st/2nd | 3+ authors: other 3rd or lower |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| One | Equal | 0.50 | 1.00 | — | — | — | — | — |
| One | 1st | 0.60 | 1.00 | — | — | — | — | — |
| One | 2nd | 0.40 | 1.00 | — | — | — | — | — |
| Two | Equal | 0.33 | 1.00 | 0.50 | 0.50 | 0.50 | — | — |
| Two | 1st | 0.40 | 1.00 | — | 0.70 | 0.60 | — | — |
| Two | 2nd | 0.35 | 1.00 | 0.50 | — | 0.40 | — | — |
| Two | 3rd | 0.25 | 0.80 | 0.50 | 0.30 | — | — | — |
| Three or more | Equal | 0.25 | 1.00 | — | — | — | 0.50 | 0.50 |
| Three or more | 1st or 2nd | 0.35 | 1.00 | — | — | — | 50–70% | 50–80% |
| Three or more | 3rd or lower | 0.15 | 0.70 | — | — | — | 30–40% | — |

Interpretation warning:
- The table's column headings and the placement of some cells are not self-explanatory for every possible affiliation/order combination.
- The Guidelines also contain narrative examples (including 40:60, 40%, 80% split and other cases) that do not perfectly collapse into one universal rule.
- Implement only deterministic cases that have been explicitly approved. For range-valued cells or unclear combinations, flag the item for Admin/Dean review rather than selecting a midpoint or inventing a rule.
- Equal authorship requires an explicit acknowledgement in the author notes that all authors contributed equally and a description of specific roles.
- The Guidelines say GL co-authors include faculty, staff or lecturers.
- The Guidelines' narrative states that outside co-authors are treated differently depending on the GL faculty member's author position. Preserve the exact examples for Admin reference and request policy sign-off for any unlisted case.

### 3.3 R&R records
- Capture R&R status and journal category for reporting.
- Owner decision: retain as an informational activity with zero points and zero compensation.
- Do not add the older Faculty Sheet's R&R formula points to R or payable points.

## 4. Patent registration

- Include Patent Registration in the Research form.
- Guideline value: **15 points**.
- Capture patent title, application/registration number, filing/registration date, jurisdiction, status, and evidence reference.
- Apply 15 points only for the qualifying registration status defined by Admin policy; the Guidelines say “Patent Registration” but do not further define application vs granted/registered status. Confirm this before final release.

## 5. Cases

| Activity | Points |
|---|---:|
| Case Publication — International | 30 |
| Case Publication — Indian | 2 |

Guideline conditions:
- International case publishing house must appear in Harvard / The Case Centre repository or equivalent.
- Indian cases must appear in IIMB, SP Jain, XLRI or equivalent repository.
- If published outside the listed repositories, Dean discretion applies.
- Owner decision: Indian case value is 2 points; use the Guidelines.

## 6. Conferences

All conference-related activities have zero points under the Guidelines' New Points column:
- Area-listed international conference presentation: 0.
- Conference organised by IIMs / top 20 B-schools in India: 0.
- Other international conference outside India: 0.
- Other Indian conference: 0.
- Handling a research conference: 0.
- Session chair in an outside conference: 0.

Guideline rationale: the institute funds conference-related expenses, so no compensation is made for presenting papers at conferences. Keep the activities in the form for disclosure/reporting if required, but do not add points.

## 7. Doctoral guidance / PhD activities

| Activity | New points |
|---|---:|
| GL doctoral committee — Chair | 25 |
| GL doctoral committee — Member | 15 |
| Evaluation of outside thesis as external examiner | 0 |
| Thesis committee membership — IIM, IIT and equivalent | 0 |
| Thesis committee membership — other universities | 0 |
| Empirical study / XPM / Flex guidance / Summer Internships | 0 |

Owner decision: empirical / internship guidance is retained as a recorded activity but earns zero compensation/points.

## 8. Books and book chapters

| Activity | New points |
|---|---:|
| Book Publication — International | 30 |
| Book Publication — National | 15 |
| Book Editing | 10 |
| Book Chapter — International | 5 |
| Book Chapter — National | 2 |
| Book revised edition | 0 |

Guideline conditions:
- Above points are only for a new book.
- National publishers listed: McGraw Hill, Macmillan, Sage, Prentice Hall, Cengage, Pearson.
- Book chapter must not be a conference paper.
- Dean discretion applies when deciding a new book vs. being a 3rd/4th author of an existing book.
- Each point is stated as worth ₹6,500 in the Guidelines. This note is not the owner-confirmed progressive payment formula; do not use it to replace the payment logic in section 14.

## 9. Journal editing and review

### 9.1 Reviewing
Guidelines New Points:
- Reviewing ABDC A* paper: 0.
- Reviewing ABDC A paper: 0.
- Reviewing ABDC B paper: 0.
- Reviewing ABDC C paper: 0.
- Reviewing IIMA/C/L journal papers: 0.
- Reviewing area-approved conference / IIM / IIT equivalent: 0.

Guideline note: reviewing papers is an external service and carries no compensation.

### 9.2 Editorship
| Editorship frequency | Points |
|---|---:|
| Twice annually / biannual | 10 |
| Four times annually / quarterly | 15 |
| Monthly | Not eligible under owner-confirmed decision |

Owner decisions:
- Use Guidelines values.
- Do not use the Faculty Sheet's monthly editorship row.
- The Guidelines do not assign points by journal rank for editorship; do not use the Faculty Sheet's rank multipliers (30/25/20/10).
- Monthly editorship is not eligible unless policy is explicitly changed later.

## 10. External research grants and industry-sponsored research

Guidelines grant tiers:

| Individual faculty share / grant value | Points |
|---|---:|
| Less than ₹1 lakh | 3 |
| ₹1 lakh to ₹3 lakh | 5 |
| Greater than ₹3 lakh | 10 |

The same tiers appear for External Research Grants and Industry Sponsored Research.

Owner-confirmed allocation:
- Determine the tier using the individual faculty member's share, not the total project grant amount.
- If multiple faculty participate, divide the grant equally among participating faculty.
- Calculate the individual share first, then apply the tier.
- Define boundary handling exactly: ₹1,00,000 is in the ₹1–3 lakh tier; ₹3,00,000 is in the ₹1–3 lakh tier; amounts strictly greater than ₹3,00,000 receive 10.
- Round currency only for display; use exact decimal currency for tier evaluation unless Finance approves another rule.

## 11. Service responsibilities

Use the Guidelines Service Responsibilities sheet and owner-confirmed values.

| Service activity / role | Points |
|---|---:|
| Directorship — PGPM | 25 |
| Directorship — PGDM | 25 |
| Directorship — PGP Flex | 10 |
| Directorship — PGXPM | 10 |
| Director — Research | 20 |
| Director — Accreditation | 20 |
| Faculty Recruitment Chair | 10 |
| Centre for Excellence | 7 |
| Committee work including special committees | 3 per committee |
| Conference coordination | 10 |
| Empirical guidance / Internship guidance | 0 |
| Admissions | 20 |
| Area Chair | 7 |

Owner decisions:
- Disciplinary Committee membership is removed entirely.
- Use Guidelines values for directorship, Area Chair, and Centre for Excellence, not the legacy Faculty Sheet values.
- Empirical / Internship guidance remains recordable but is zero compensation.
- The Guideline rows Invited Lecture, Placements, ES for PGDM, Gartner and Others have no New Points value; do not assign points without confirmation.
- The Faculty Sheet's popular media article and Great Lakes staff PhD guidance fields do not have corresponding confirmed point values in the Guidelines service table. Keep them out of scored totals until the owner approves a mapping, or retain them as unscored disclosures if needed.

## 12. Teaching policy

Guidelines Teaching sheet:
- Research-active faculty contractual teaching load: 120 hours.
- Assistant Professors joining as new faculty: 80 hours for the first two years, then 120 hours.
- Teaching cap: 225 hours; 250 hours for non-research faculty.
- Any deviation requires case-by-case discussion with the Dean.
- Cap excludes CLD / PGDM Online / Gurgaon teaching.
- Professors of Practice and faculty not active in research for the last four years: 160 hours.

Overload compensation rates:
| Designation | Overload teaching rate |
|---|---:|
| Full Professor | ₹7,000/hour |
| Senior Associate Professor | ₹6,500/hour |
| Assistant / Associate Professor | ₹6,000/hour |

CLD teaching rates:
| Designation | CLD rate |
|---|---:|
| Full Professor | ₹9,000/hour |
| Senior Associate Professor | ₹8,000/hour |
| Assistant / Associate Professor | ₹7,000/hour |

Keep contractual load, teaching cap, teaching hours, teaching points, and payment rates as separate fields/configuration values. Owner-confirmed payment formula in section 14 controls the points payment calculation. Clarify how CLD hours interact with that formula before implementation.

## 13. Eligibility and payable points

- Standard faculty minimum: 200.
- Junior Faculty minimum: 30.
- Both confirmed by owner.
- New faculty minimum: service-duration prorating retained by owner.
- The Admin workbook shows the general pattern `pointsPayable = max(totalPoints - minimumPoints, 0)`.
- Use a decimal-safe calculation and define rounding only at the final currency display/payment stage.

## 14. Owner-confirmed progressive payment formula

Let:
- `P` = Points Payable.
- `R` = Research points (the Research component used as the first payment band).
- `researchRate` = ₹7,000 per point (stored/configurable parameter).
- `designationRate` = designation-based rate stored/configurable parameter.

Then:

If `P <= R`:

`payment = P × researchRate`

If `P > R`:

`payment = (R × researchRate) + ((P − R) × designationRate)`

This is a progressive / marginal-band formula, not a flat rate across all payable points.

Implementation requirements:
- `researchRate` defaults to ₹7,000 but is configurable with effective date and audit history.
- `designationRate` is looked up from an Admin-controlled configuration table.
- Do not infer the designation rate from a display label; use a normalized designation key.
- Use `P` after minimum-point deduction, exactly as confirmed by the owner.
- Keep any separately calculated teaching overload / CLD compensation distinct unless the owner confirms it is included in this payment formula.
- Unit test boundary conditions: `P=0`, `P<R`, `P=R`, `P>R`, `R=0`, and fractional points.

### Example
Assume `P=230`, `R=80`, `researchRate=₹7,000`, `designationRate=₹6,000`:
- First band: 80 × 7,000 = ₹5,60,000.
- Remaining: 150 × 6,000 = ₹9,00,000.
- Total = ₹14,60,000.

This example illustrates the formula only; it is not a policy value for any particular faculty member.

## 15. Admin payment reconciliation

The Admin workbook contains current-year columns:
- Paid.
- Corrected.
- Differential / To be paid.

It also retains prior academic-year payment columns. Model these as payment records keyed by faculty and academic year:
- `paidAmount`
- `correctedAmount`
- `differentialAmount = correctedAmount - paidAmount` (confirm whether this sign convention is intended; the workbook calculates Corrected minus Paid)
- payment status / reference / note / timestamp

Do not overwrite historical-year amounts. Distinguish system-calculated expected amount from Finance-entered paid/corrected amount.

## 16. Spreadsheet discrepancies / items requiring policy sign-off

1. Faculty Sheet uses older publication contribution multipliers on `Sheet3`; owner explicitly says do not use it. Use Guidelines Publications matrix.
2. The Guidelines contribution table has ranges and ambiguous mixed-affiliation cases. Admin/Dean must decide them; do not pick arbitrary midpoints.
3. Faculty Sheet directorship values differ from Guidelines: e.g. PGPM/PGDM 40 in Faculty Sheet vs. 25 in Guidelines. Owner says Guidelines.
4. Faculty Sheet Area Chair 10 vs. Guidelines 7. Owner says Guidelines.
5. Faculty Sheet Centre for Excellence 10 vs. Guidelines 7. Owner says Guidelines.
6. Faculty Sheet contains Disciplinary Action Committee membership; owner says remove it.
7. Faculty Sheet empirical/capstone and internship formulas calculate positive values; Guidelines say zero and owner confirms zero compensation.
8. Faculty Sheet editorship calculates points by journal rank and includes monthly; owner says fixed Guidelines values only and monthly not eligible.
9. Faculty Sheet case formula labels Indian cases as “Emerald” and gives 10, while Guidelines say Indian case 2; owner says Guidelines.
10. Faculty Sheet conference formula appears inconsistent with Guidelines; all conference activities have zero New Points.
11. Guidelines Publications lists R&R point values (30/20/15) but says no compensation; owner further clarifies informational zero-point activity. Store as zero in scoring.
12. Guidelines grant tiers are written as “value of grant”; owner clarifies threshold applies to each faculty member's individual share and equal sharing.
13. Teaching guideline contains hourly rates and workload rules; owner provides a distinct progressive points-payment formula. Do not conflate hours with points.
14. Faculty and Junior Faculty Admin sheets include historical amounts and hard-coded examples; do not import sample names or sample values as production faculty data.
15. Faculty Sheet has a reporting-period label and sample personal data; treat these as examples only, not default live values.


## Submitted and approved R/T/S values

The scoring engine must calculate and retain submitted Research (R), Teaching (T), and Service (S) points as three separate values. The submission record must also retain three separate Admin-approved values: approved R, approved T, and approved S.

At submission, initialize approved R/T/S to the corresponding submitted R/T/S values. Admin may adjust each approved category independently during review. Submitted category values must remain unchanged. Submitted total = submitted R + submitted T + submitted S; approved total = approved R + approved T + approved S. These totals must be calculated independently and must never share a mutable field.

The final faculty PDF (after Admin approval) must show all six category values and both independently calculated totals. The initial PDF shows only the submitted values (owner decision 2026-11-22). This section defines storage and presentation behavior; it does not change any scoring weights, policy values, eligibility thresholds, or payment rules above.
