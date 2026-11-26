# RTS Faculty App — Requirements
**Version:** 2.2  
**Status:** Working implementation specification  
**Source workbooks reviewed:**
1. `RTS_25-26 - April2026_Prof 1.xlsm` — faculty input sheet and its lookup/multiplier sheets.
2. `RTS Final Draft 25-06-2026.xlsx` — consolidated Admin sheets for Faculty and Junior Faculty.
3. `Copy of RTS-Guidelines-Policies_2023_final (1).xlsx` — policy and scoring reference.

> Policy precedence: explicit decisions confirmed by the product owner in the project conversation override conflicting workbook content. Where the owner has not clarified a conflict, preserve the source wording and flag it for Admin/policy-owner confirmation. Do not silently infer a policy.

## 1. Product objective

Replace the current RTS (Research, Teaching and Service) spreadsheet workflow with a small web application that:
- Collects annual faculty RTS submissions in a structured form.
- Calculates provisional points using centrally maintained policy rules.
- Allows Admin to review, correct, approve, and consolidate submissions.
- Calculates points payable and incentive/payment estimates using configurable parameters.
- Generates and emails an initial faculty-specific PDF immediately after submission, then generates and emails a final PDF after Admin approval.
- Captures whether the faculty member actually received the export and supports email correction/resend.
- Maintains an auditable record of submissions, changes, approvals, exports, and email events.

The system is an administrative workflow tool, not an identity-management platform or a replacement for institutional HR/payroll.

## 2. Roles and access model

### 2.1 Faculty
- Open the Faculty portal, select their name from an Admin-maintained Faculty Master List, and enter their unique individual secret/access code.
- After successful validation, create and edit submissions associated with their own Faculty Master record during the configured submission window.
- The dropdown must not expose faculty email addresses; display only the minimum identifying information needed (e.g. name and, if necessary, designation).
- Enter faculty identity details (name, designation, email, date of joining where applicable) and RTS activity details.
- Save drafts and see calculated provisional totals.
- Submit the completed declaration for Admin review.
- See a submission receipt/status and the export-email confirmation flow for that submission.
- Confirm receipt, request an email-address correction from Admin, or contact Admin.
- Download an export directly from the application if that feature is enabled by Admin.

**Faculty identity model:** Faculty do not receive conventional username/password accounts in the first release. Instead, Admin creates a Faculty Master record and issues a unique individual secret/access code. The faculty member selects their name and supplies that secret. The server validates the combination and establishes a session bound to that Faculty Master record. Never use one common secret for all faculty. Store only a strong password hash of the secret; support revocation and regeneration; rate-limit failed attempts; do not reveal whether a name or secret was the incorrect part. Faculty must only access records associated with their authenticated Faculty Master record.

### 2.2 Admin
- Sign in using the configured Admin role credential.
- View all submissions in a consolidated list.
- Filter by academic year, faculty name, designation, submission status, review status, and email/export status.
- Open any submission and inspect the faculty-entered data, calculated points, evidence/attachments (if enabled), and calculation breakdown.
- Correct faculty details and submission data where authorized.
- Record review notes, request clarification, return a submission, approve/reject it, and lock an approved submission.
- Review faculty-submitted points alongside Admin-approved points; approved points default to submitted points and may be changed by Admin with a reason and audit trail.
- Final approval triggers a new PDF containing both submitted and approved points and emails it to the current Faculty Master email address.
- Correct a faculty email address and resend the export.
- Compare submitted points with approved points at activity/score-line level; approved points are initialized to submitted points. Admin may change approved points, must provide a reason for each override (or grouped override), and the system records before/after values, actor, and timestamp.
- Final approval locks the approved values and triggers the final PDF/email containing submitted and approved points.
- View email send attempts, provider responses, delivery/bounce events where supported, and faculty receipt confirmation.
- Maintain policy/configuration values only through an explicit Admin configuration workflow or controlled deployment configuration; changes must be audited and versioned.
- Export consolidated data for reporting and finance review.

## 3. Authentication and security requirements

The product owner has explicitly requested no separate Auth.js or department SSO. Implement:
- Admin uses a configured Admin login (`ADMIN_LOGIN_USERNAME` and `ADMIN_LOGIN_PASSWORD_HASH`, or equivalent secret-backed configuration).
- The system generates a cryptographically secure, unique access secret for each Faculty Master record. Display the raw secret to Admin only once at creation/regeneration so Admin can distribute it individually to that faculty member. Store only a strong hash (Argon2id or bcrypt with an appropriate work factor); never store or redisplay the raw secret.
- Support secret revocation/regeneration, failed-attempt throttling, generic authentication errors, and audit events for issue/revoke/reset actions.
- Use secure, HttpOnly, SameSite cookies; `Secure` in production; short-lived sessions and server-side session invalidation.
- Rate-limit login attempts and provide generic authentication errors.
- Protect all server actions/API routes with role checks; hiding UI controls is not authorization.
- CSRF protection for state-changing requests where cookie-based sessions are used.
- Validate and normalize all user input server-side.
- Do not expose secrets, database credentials, mail-provider keys, or full email delivery payloads to the browser.
- Log Admin actions and security-relevant events.

The Faculty Master + system-generated unique individual secret model is the approved faculty identity mechanism for this release. Admin distributes each secret individually outside the application. Do not replace it with a shared Faculty password. Do not add institutional SSO unless requested.

## 4. Academic year and submission lifecycle

Academic year is a first-class entity/configuration value. The example faculty workbook labels the period `April 1, 2025 - March 31, 2026`; the Admin workbook is labelled `AY 2025-26`. Do not hard-code this date range for all future cycles.

Submission states:
1. `DRAFT` — editable by the submitter.
2. `SUBMITTED` — submitted to Admin; faculty edits are disabled unless Admin returns it.
3. `UNDER_REVIEW` — Admin is reviewing.
4. `NEEDS_CLARIFICATION` — Admin has returned it with comments.
5. `APPROVED` — Admin has approved and locked the reviewed version.

**Submitted versus approved points (R, T, and S must be stored separately)**

- Maintain six distinct category-level values for every submission: `submitted_r_points`, `submitted_t_points`, `submitted_s_points`, `approved_r_points`, `approved_t_points`, and `approved_s_points`.
- At initial submission, copy each submitted category value into its corresponding approved value: approved R = submitted R, approved T = submitted T, and approved S = submitted S.
- Submitted R/T/S values are immutable after submission. Admin review must never overwrite or alter them.
- Admin can independently adjust the approved R, approved T, and approved S values. An adjustment to one category must not silently change the other two categories.
- Keep the underlying submitted activity entries and their calculated scores for traceability. Where Admin makes activity-level corrections, retain the original submitted line and record the approved line/value separately.
- Derive submitted total points from submitted R + T + S, and approved total points from approved R + T + S. Do not use one shared R/T/S total for both views.
- Record each Admin adjustment with before/after values, category (R/T/S), Admin identity, timestamp, and mandatory reason. Retain the full audit history.
- Final approval locks the approved R/T/S values and the approved total. Any post-approval change must use an explicit reopen/amendment workflow and create a new audit event.
- **Owner decision (2026-11-22):** the initial PDF (sent on submission) shows only the submitted R, T, S, total, eligibility and indicative payment. Approved values, differences and Admin review notes appear only in the final PDF generated after Admin approval, which shows submitted R, T, S and total alongside approved R, T, S and total. Approved values are still stored (initialized from submitted) from the moment of submission.

Requirements:
- Save drafts automatically or provide explicit Save Draft.
- Show validation errors before submission.
- Require acknowledgement that entered information is complete and accurate.
- Capture submission timestamp and the exact policy/configuration version used.
- Admin changes after submission must be recorded in an audit log with before/after values, actor role, timestamp, and reason.
- When Admin requests clarification, record the query and response history.
- Recalculation after a policy change must not silently alter already approved submissions. Store a policy version/snapshot and require an explicit Admin recalculation action.
- **Changing a year's policy version (owner decision 2026-11-24):** allowed while the year's submissions are only drafts or rejected. Drafts move to the new version; rejected submissions stay locked under the version they were scored with, as history. A faculty member whose submission was rejected may start a fresh submission, created under the year's current version. A rejected submission cannot be reopened once a fresh one exists or the year has moved to another version. Submitted, under-review, needs-clarification or approved submissions still block the change.

## 5. Faculty data collection

### 5.1 Faculty Master List and reporting period
Admin maintains the Faculty Master List. Each record contains:
- Faculty name.
- Email address.
- Designation.
- Date of joining / service start date where required for eligibility prorating.
- Faculty category (standard / Junior Faculty) — derived from the designation, not entered (owner decision 2026-11-26: only Junior Faculty and Librarian are Junior; no override).
- Unique individual access-secret hash and access status (active/revoked).
- Optional internal faculty identifier.

Faculty selects their record from a dropdown and authenticates with their individual secret. Name, email, designation, date of joining, and faculty category are populated from the master record; Faculty cannot edit these values in the submission form. The dropdown must not expose email addresses. Faculty may submit an email correction request, but only Admin can approve and update the master record.

Submission-specific fields:
- Academic year / reporting period (selected from configured open periods).
- Faculty declaration and activity data.
- Any policy-required exception flags (e.g., Professor of Practice, research-inactive status) must be Admin controlled, not self-certified without review.

Validation:
- Name is required.
- Admin-entered email must pass syntax validation and be normalized (trim whitespace; lowercase domain; preserve local-part case as appropriate).
- Date of joining must be a valid date and cannot be after the reporting period end date.
- Designation and faculty category must come from configured lists.
- Faculty cannot change master identity fields. Email corrections are requests routed to Admin approval.
- The app must not treat a syntactically valid email as proof that the mailbox exists.

### 5.2 Teaching activity
The Faculty Sheet captures course-level teaching data with the following columns:
- Course name.
- Number of sections.
- Number of students.
- Student feedback.
- Hours by teaching programme: PGPM, PGDM II Year, PGDM I Year, FLEX, XPM, FPM, CLD, Others (including GLPSS / OPGDM).
- Calculated total hours for each course.
- Total hours across courses.
- Total hours excluding CLD (the workbook calculates total hours less CLD).
- Teaching points / teaching contribution used in the overall RTS calculation.

UI requirements:
- Allow multiple course rows.
- Allow a course row to have hours in one or more programme columns.
- Validate counts and hours as non-negative numbers.
- Student feedback may be blank if unavailable; do not invent a default rating.
- Calculate row totals and section totals on the server and display the breakdown.
- Support courses with no value in optional columns; retain the field and show blank/Nil in exports rather than deleting it.
- The Admin must be able to correct values with an audit reason.

Policy rules from the Teaching guideline:
- Research-active faculty contractual teaching load: 120 hours.
- New faculty joining at Assistant Professor level: 80 hours for the first two years of service, then 120 hours.
- Teaching cap: 225 hours; 250 hours for non-research faculty. Deviations are case-by-case with the Dean.
- The stated cap excludes teaching in CLD / PGDM Online / Gurgaon.
- Professors of Practice and faculty not active in research for the last four years: 160 hours.
- Overload rates in the guideline: Full Professor ₹7,000/hour; Senior Associate Professor ₹6,500/hour; Assistant/Associate Professor ₹6,000/hour.
- CLD rates: Full Professor ₹9,000/hour; Senior Associate Professor ₹8,000/hour; Assistant/Associate Professor ₹7,000/hour.

The owner has separately clarified the payment calculation described in `SCORING_MAPPING.md`. Keep contractual load, cap, hours, points, and payment rate as distinct concepts; do not collapse them into one field.

### 5.3 Service activity
The Faculty Sheet includes:
- Directorship / programme responsibility (selected from configured options).
- Area Chair (Yes/No).
- Centre for Excellence (Yes/No).
- Empirical / Capstone project guidance count.
- Internship guidance count.
- Conference organisation type (International / Domestic / None).
- Great Lakes staff PhD guidance count.
- Popular media articles authored (A category only) count.
- Calculated service points and total service points.

Owner-confirmed policy decisions:
- Use only the roles and point values in the Guideline Sheet for directorship/service responsibilities.
- Directorship: PGPM 25; PGDM 25; PGP Flex 10; PGXPM 10.
- Director – Research 20; Director – Accreditation 20.
- Faculty Recruitment Chair 10.
- Centre for Excellence 7.
- Committee work including special committees 3 per committee.
- Conference coordination 10.
- Empirical guidance / internship guidance 0 points.
- Admissions 20.
- Area Chair 7.
- Remove Disciplinary Committee membership entirely from the application.
- Do not use the Faculty Sheet's older directorship/Area Chair/Centre for Excellence/disciplinary values.
- Other/blank service rows in the guideline (Invited Lecture, Placements, ES for PGDM, Gartner, Others) are not to be assigned points unless the owner confirms a rule.

### 5.4 Research activities
The Faculty Sheet includes these research sections:
- Accepted publications.
- Papers with R&R status.
- Papers reviewed.
- Editorships.
- Books / book chapters.
- Cases.
- Conference papers presented.
- External grants and industry-sponsored research.
- GL doctoral committee students supervised.

The app should provide repeatable rows for activities and collect the descriptive details needed for Admin verification. Do not restrict the number of rows to the number of visible spreadsheet rows; the spreadsheet's fixed rows are a layout limitation, not a policy limit.

Recommended activity fields (where applicable):
- Activity category and subtype.
- Title / publication or project name.
- Journal / publisher / case repository / sponsor.
- Publication or acceptance date.
- DOI / URL / reference number.
- Journal rank/category at the relevant policy date.
- Author count; each author's institution affiliation type (Great Lakes / international external / domestic external); faculty's author order; equal-contribution declaration.
- Grant total amount, faculty's share, participating faculty, and share allocation.
- Supporting document upload, if enabled.
- Faculty note and Admin review note.

Do not mark any activity as verified solely because it was entered by Faculty.

## 6. Scoring and eligibility

- All points must be calculated on the server using a versioned policy configuration.
- Display Research (R), Teaching (T), Service (S), Total Earned Points, Minimum Required Points, Points Payable, and the payment calculation separately.
- Standard faculty minimum: 200 points.
- Junior Faculty minimum: 30 points.
- New-faculty minimum is prorated according to service duration; preserve the workbook's date-of-joining approach but make the exact prorating convention explicit/configurable and confirm leap-year/partial-month treatment before production.
- Points below the minimum are not payable; see the formula in `SCORING_MAPPING.md`.
- R&R activities remain visible as informational records but contribute zero payable points under the owner's clarification.
- Reviewing papers and conference activities carry zero points under the Guidelines.
- Grants use the participating faculty member's individual share to determine the point tier; where multiple faculty participate, split equally unless the owner explicitly configures another allocation.
- Patent Registration is included in the Research form and scores 15 points.
- Never hard-code monetary values in UI components. Use named configuration parameters with effective dates and audit history.

## 7. Admin consolidated view

The Admin workbook has two separate consolidated sheets:
- Faculty.
- Junior Faculty.

The Faculty consolidated sheet contains:
- Serial number, Name, Designation, Date of Joining.
- FPM indicator / rate context.
- Experience in GL.
- Rate per hour (Teaching and Research Points / Services).
- Minimum points.
- Points earned, R, T, S, payable points.
- Current AY payment columns: Paid, Corrected, Differential / To be paid.
- Historical AY payment columns.

The Junior Faculty sheet contains:
- Serial number, Name, Designation, Rate INR.
- R, T, S, Total Points, Minimum Points, Points Payable.
- Current AY Paid, Corrected, Differential / To be paid.
- Historical year payment columns.

Requirements:
- Consolidated totals must be derived from individual submissions, not manually re-entered.
- Historical payment values may be imported as opening balances/reference values, but must be clearly marked as imported historical data and not mistaken for current calculations.
- Admin can enter or correct Paid and Corrected values; calculate Differential / To be paid as configured.
- Provide CSV/XLSX export of consolidated views.
- Maintain separate Faculty and Junior Faculty views and apply the correct minimum eligibility.
- Preserve payment history by academic year; do not overwrite prior-year figures.

## 8. Export and email workflow

### 8.1 Export generation
- Generate and email the initial faculty-specific PDF immediately after successful submission.
- Generate and email a second, final PDF when Admin gives final approval. This final PDF must show both faculty-submitted points and Admin-approved points, including any differences.
- The initial PDF shows only the submitted points (owner decision 2026-11-22); approved points are not shown until final approval.
- Include every required field from the source forms. If a value is missing, render the field as blank or `Nil`; do not remove the field.
- Include R/T/S subtotals, earned points, minimum eligibility, points payable, calculation explanation, submission status, and relevant Admin notes.
- Use a stable export template/version and retain the generated file reference and generation timestamp.
- Export format is confirmed as PDF for faculty-specific exports. Admin consolidated reporting export format may be configured separately.

### 8.2 Email dispatch
- Send the export to the email address maintained in the Admin Faculty Master List.
- Record recipient, submission ID, export ID, provider message ID, attempt number, requested/sent timestamp, provider acceptance/rejection, error code/message, and delivery/bounce event if the provider supports webhooks.
- Retry transient provider failures with bounded retries; do not retry permanent invalid-recipient failures indefinitely.
- Do not claim inbox delivery based solely on an SMTP/API success response.
- Admin can correct the email address, record the reason, and resend the export.
- Resending creates a new email attempt and must not overwrite prior attempts.

### 8.3 Faculty receipt-confirmation flow (required)
After the app attempts to send the export, show:
**“Did you receive the file export by email?”**
- **Yes:** record `FACULTY_CONFIRMED_RECEIPT`, timestamp, and the email address shown to the faculty member.
- **No:** show the email address used and ask the faculty member to verify it.
- If incorrect: Faculty submits an email correction request with the proposed new address and optional explanation. The request does not immediately change the master record and does not trigger a resend.
- Admin reviews the request and may accept the faculty member's direct confirmation as sufficient verification. Admin records the decision and reason; no institutional-directory verification is required by this specification.
- On approval, update the Faculty Master email address, retain the previous value in the audit history, and allow Admin to resend the latest applicable PDF to the newly approved address.
- If the address is correct but the export was not received, advise checking spam/junk and then contacting Admin; create an unresolved email issue for the Admin queue.
- Show a clear message: “Your email address can only be changed by Admin. Your correction request has been sent for review.”
- The flow must distinguish `SEND_ACCEPTED`, `DELIVERED` (only if provider webhook confirms), `BOUNCED`, `FAILED`, and `FACULTY_CONFIRMED_RECEIPT`. These are different facts.
- Provide an Admin queue for unresolved email cases.

### 8.4 Notifications
- Notify Admin when a submission is received.
- Notify Faculty when submission is received, returned for clarification, approved/rejected, or export is resent, as configured.
- Avoid sending sensitive submission details in notification subject lines.
- Email templates must be configurable and versioned.

## 9. Non-functional requirements

### Reliability and data integrity
- No lost submissions on refresh/navigation.
- Use database transactions for submission, approval, payment correction, and audit writes.
- Enforce referential integrity.
- Use idempotency keys for export generation and email dispatch to prevent duplicate sends on retries.
- Back up the SQLite database and test restoration. Backups must be stored outside the application container.

### Performance
- The anticipated scale is small (faculty annual submissions), but queries must be indexed by academic year, status, faculty, and submission ID.
- Keep PDF/XLSX generation and email dispatch out of long-running request handlers; use a job mechanism if the deployment platform supports it.

### Privacy and security
- Restrict Admin-only data and actions on the server.
- Encrypt traffic with HTTPS.
- Protect uploaded evidence and generated exports; do not expose predictable public file paths.
- Apply file type/size validation and malware scanning if uploads are enabled.
- Minimize personal data and define retention/deletion rules with the institution.
- Audit all Admin edits and policy changes.

### Accessibility and usability
- Responsive desktop-first UI with usable tablet/mobile layouts.
- Keyboard-accessible forms, labels, focus states, clear errors, and adequate contrast.
- Provide a review summary before final submission.
- Make point calculations explainable, not just numeric.

## 10. Configuration

Configuration must include:
- Academic year start/end and submission open/close dates.
- Faculty/Admin login identifiers and password hashes.
- Email provider credentials, sender address, and Admin contact address.
- Research baseline rate (₹7,000 as currently confirmed).
- Designation-based rates and CLD rates.
- Minimum points (standard 200; Junior Faculty 30).
- Service and research scoring policy tables.
- New-faculty prorating convention.
- Export format and template version.
- Feature flags for faculty self-correction of email, evidence uploads, and direct download.

All policy changes must have effective dates and an audit trail.

## 11. Acceptance criteria

1. Faculty can create, save, validate, and submit an RTS record.
2. All required spreadsheet fields are represented in the application or explicitly marked not applicable; no field silently disappears from the export.
3. R/T/S and payable points are calculated server-side and match approved test cases.
4. Standard and Junior Faculty minimums are applied correctly.
5. New-faculty prorating is calculated according to the approved convention.
6. Admin can review, return, correct, approve, and export submissions.
7. Admin consolidated Faculty and Junior Faculty views are generated from source submissions and payment history.
8. Faculty-specific export can be generated and emailed.
9. The post-send “Did you receive the file export by email?” flow works for Yes, No/correct address, No/incorrect address, and contact Admin outcomes.
10. Email attempts, provider events, faculty receipt confirmations, address corrections, and resends are auditable.
11. Admin login and unique faculty-secret authentication work; each Faculty session is bound to exactly one Faculty Master record.
12. Database backup and restore are tested.
13. Deployment architecture uses durable storage; ephemeral serverless local disk is not treated as persistent SQLite storage.
14. A deliberate, documented migration path exists from SQLite to PostgreSQL/Supabase.

## 12. Open questions and source discrepancies

The following must be resolved before final policy sign-off:
1. **Email delivery provider:** Which provider will be used, and does it expose delivery/bounce webhooks?
4. **Email delivery provider:** Which provider will be used, and does it expose delivery/bounce webhooks?
5. **New faculty prorating:** Exact day/month convention and treatment of partial months/leap years.
6. **Teaching load/payment:** The Teaching guideline defines contractual loads, caps and hourly rates, while the Admin workbook contains a different payment formula structure. Owner-confirmed payment formula is documented in `SCORING_MAPPING.md`; confirm whether CLD hours are paid in addition to the formula or handled separately.
7. **Directorship:** Guideline lists PGPM/PGDM 25 and PGP Flex/PGXPM 10. Faculty Sheet contains older values. Owner has confirmed Guideline values. Confirm whether FPM programme directorship is intentionally excluded.
8. **Service roles:** The Guideline has blank New Points for Invited Lecture, Placements, ES for PGDM, Gartner, and Others. These remain unscored until clarified.
9. **Editorship:** Guideline defines twice-yearly 10 and four-times-yearly 15. Owner says monthly editorship is not eligible. Confirm whether journal rank changes these fixed points; do not use the Faculty Sheet's journal-rank multipliers unless explicitly approved.
10. **Publication co-authorship:** The Guidelines contain separate tables/notes and some ambiguous mixed-affiliation ranges. Confirm edge cases not explicitly represented by a deterministic table.
11. **Grant sharing:** Owner confirmed equal sharing and tier based on individual share. Confirm how fractional currency amounts are rounded before tier evaluation.
12. **Admin historical data:** Confirm whether historical payment columns should be imported as read-only history or entered manually.
13. **Faculty Sheet anomalies:** The workbook's formula cells and dropdown labels are inconsistent in places (e.g., cases and editorships); the confirmed Guidelines/owner decisions take precedence.
14. **Deployment:** If the app is hosted on Vercel, do not use a local SQLite database file as the production database. Choose persistent-disk hosting, a hosted SQLite-compatible service, or PostgreSQL/Supabase before production.
