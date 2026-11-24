# Open policy questions

Updated 2026-11-24 after the owner's **points revision** (`Updated-RTS points_proposed revisions.xlsx`,
now the final source of truth for point values) and the **sign-off comments** on
`RTS_Faculty_Input_and_Scoring_Signoff_Mockup.xlsx`. Both are applied in policy `2025-26.v2`.

Nothing below was guessed silently. Each open item is either a configurable value marked
`signoff: PENDING` (the app shows an Admin-review warning wherever it affects a score) or a
documented interim behaviour. Once the owner decides, the Admin changes the value — or marks it
**Confirmed** — in **Admin → Policy → Edit values as new version**; no code change is needed.

## Still open (please decide)

| # | Topic | What the app does now (v2) | Decision needed |
|---|---|---|---|
| 1 | **OPGDM hours** | Separate OPGDM column. Hours count for T points (the old combined "Others (GLPSS / OPGDM)" column did) but not towards the teaching cap (Guidelines: PGDM Online excluded from cap). Flagged *pending*. | Do OPGDM hours earn T points? Count towards the cap? |
| 2 | **PGP Flex Programme Director** | Revision names "PGXPM and FPM" (20) but not PGP Flex, which shared the old 10-point row with PGXPM. Scored 20, flagged *pending*. | Keep PGP Flex at 20, another value, or remove the role? |
| 3 | **Popular press & trade publications** | Revision shows "0.3 currently" and no proposed value; Open Decisions #12 says popular media is excluded from points. Recorded as a research section at **0**, flagged *pending*. | 0, 0.3 per article, or another value? Same for trade journals? |
| 4 | **Grant share below ₹50,000** | Revision lists ₹50,000–₹2,00,000 = 5 and > ₹2,00,000 = 10. Shares below ₹50,000 score **0**. Boundaries: ₹50,000 and ₹2,00,000 both earn 5. | Confirm 0 below ₹50,000 and the inclusive boundaries. |
| 5 | **Conducting conferences — R or S?** | The revision lists "Conducting Academic Conferences for GLIM Chennai" (international 40, national 30) among research items; its "current 10" matches the old *Service* role "Conference coordination". Implemented as **Service** (S), per conference. Matters for pay: R is paid first at the research rate. | Research or Service? |
| 6 | **Conference track chair "Nil … if travel and stay are not funded by GL"** | Track chair entries score 0 regardless; a "funded by GL?" Yes/No is recorded. | Is Nil unconditional, or do track chairs earn points when GL does *not* fund travel? |
| 7 | **Items the revision does not list** | Kept at earlier owner-confirmed / Guidelines values: Indian case **2**, doctoral committee Chair **25** / Member **15**, Faculty Recruitment Chair **10**, Admissions **20**, Patent **15**, R&R / reviews **0**. | Confirm these stay, or give new values. |
| 8 | **Junior Faculty and staff publications** | Revision note: "For faculty after 200 points achieved. For JF and staff, it is per publication if it is with GL, Chennai affiliation." The app applies the normal Junior minimum (30) and the progressive formula; staff are not users of the app. | Should Junior Faculty publications be paid per publication without the minimum? Is a GL Chennai affiliation flag needed on publications? |
| 9 | **Large elective rate (1.25 / hour)** | Applies when the faculty member picks the course type "Elective, 100+ students in one section, evaluated by faculty" **and** students ÷ sections ≥ 100; otherwise 1 / hour with a warning. Admin verifies every 1.25 line. | Is students ÷ sections the right test of "≥ 100 in one section"? |
| 10 | **Editorship — unlisted journals; "best 2"** | Only FT50 / A* / A / B / C earn points (30 / 25 / 20 / 10 / 5); other journals are recorded as not eligible. Only the 2 highest-scoring editorships count. | Confirm. |
| 11 | **FPM component in payments** | Admin workbook adds FPM count × ₹10,000 in its "Corrected" column. The app records FPM count/rate on the payment record but does not add it to the calculated payment. (Revision: FPM teaching hours now count at the normal 1 point / hour.) | Is the FPM payment line still needed? |
| 12 | **Email provider** | Outbox (dev) and SMTP adapters; generic signed webhook for delivery / bounce. | Which provider? Map its webhook payload. |
| 13 | **Historical payments** | Admin enters them per year, marked "imported". | Bulk import needed? |
| 14 | **Differential sign** | Corrected − Paid (workbook). | Confirm. |

## Resolved by the Nov 2026 sign-off (now implemented)

| Topic | Decision | Where |
|---|---|---|
| Teaching hours → T points | Approved: 1 point per non-CLD hour; large electives 1.25 | `teaching.pointsConversion`, `teaching.courseTypes` |
| CLD | No calculation; excluded from points and payables | `teaching.cld.showCompensationSeparately: false` |
| Teaching cap | Faculty may enter any hours; Admin decides on approval (warning only) | engine warning `TEACHING_CAP_EXCEEDED` |
| Prorating | Days in service ÷ days in the year, for **new and exiting** faculty (joining / exit dates inclusive; leap years use 366) | `prorating.basis: PERIOD_DAYS`; Faculty Master "Date of exit" |
| Contribution matrix | Exact cells applied; ranges go to Admin/Dean (Admin can set a fixed factor in the editor) | `publication.contributionMatrix` |
| Co-author count | Excludes the submitting faculty member; 3+ co-authors use the "three or more" bucket | field label + help text |
| Sole author | Factor 1.00 confirmed | `publication.soleAuthor` |
| Designation rates | Confirmed; editable per year | `designations.items[].pointRate` |
| Research rate | ₹7,000, editable per academic year | `parameters.researchRatePerPoint` |
| Payment rounding | Ceiling to the next rupee | `paymentRounding: CEIL_RUPEE` |
| Concurrent service roles | Allowed; roles stack | Service tab; "Other service / additional roles" for unlisted ones |
| Unmapped disclosures | Excluded from points | `service.disclosures` |
| Evidence | Admin's decision | line review |
| "Faculty has PhD?" | Removed from the form, PDF and Faculty Master | — |
| GLPSS / OPGDM | Two columns; GLPSS counts like any non-CLD hours | `teaching.columns` |
| Many teaching rows | "Add 5 / 10 / 15 / 20 rows"; blank rows are ignored on submit | Teaching tab |
| Remarks when approved ≠ submitted | Admin remark per category (required); printed on the final PDF with any line-override reasons | Review page, final PDF |
| Mid-year policy change | Allowed when the year has only drafts and rejected submissions; rejected stay as v-locked history and the faculty member starts a fresh submission (2026-11-24) | `assignPolicyToYear`, `startSubmission` |
| Per-year parameters | Every point value and rate is editable from the portal as a new version per academic year | Admin → Policy → Edit values as new version |
