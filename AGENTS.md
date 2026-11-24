# AGENTS.md — RTS Faculty App
**Version:** 2.2  
**Purpose:** Guardrails and execution plan for AI coding assistants and developers.

## 1. Product context

Build a small RTS (Research, Teaching, Service) faculty submission and Admin review application. It replaces spreadsheet-based annual data collection and payment consolidation.

The source materials are:
- `RTS_25-26 - April2026_Prof 1.xlsm` — Faculty form fields and legacy formulas.
- `RTS Final Draft 25-06-2026.xlsx` — Admin consolidated Faculty and Junior Faculty sheets.
- `Copy of RTS-Guidelines-Policies_2023_final (1).xlsx` — authoritative scoring/policy source unless the product owner explicitly overrides it.

Read `REQUIREMENTS.md`, `SCORING_MAPPING.md`, and `DESIGN.md` before coding. These documents incorporate owner-confirmed policy decisions.

## 2. Non-negotiable guardrails

> **Nov 2026 owner revision.** `Updated-RTS points_proposed revisions.xlsx` is now the final source
> of truth for point values (implemented in `config/policy/2025-26.v2.yaml`). Where it differs, the
> v2 values noted below override the original guardrail values, which still describe the immutable
> v1 policy. Point values are **data**: change them through Admin → Policy (new version per academic
> year), never in code. See `SCORING_MAPPING.md` §0 and `docs/OPEN_QUESTIONS.md`.

1. **Do not invent policy.** If a rule is missing, ambiguous, or range-valued, surface it as an Admin-review warning and add it to the open-questions list.
2. **Policy precedence matters.** Owner-confirmed decisions override workbook conflicts. Guidelines override the legacy Faculty Sheet formulas.
3. **Do not use Faculty Sheet `Sheet3` publication multipliers.** Use the Guidelines Publications contribution table and flag ambiguous cases.
4. **Do not reintroduce removed scoring.** (v1.) v2: Disciplinary Action Committee membership = 10; empirical study guidance 0.3 per group (max 10) and internship guidance 0.3 per student; other committee memberships 0. Conference presentations / track chairs, reviewing and R&R still score zero.
5. **Use the confirmed service values.** (v1.) v2: Programme Director PGPM/PGDM 40; PGXPM/FPM 20 (PGP Flex 20 pending); Director Research 10; Accreditations 20; Centre of Excellence 10; Area Chair 10; conducting conferences 40 international / 30 national; Faculty Recruitment Chair 10; Admissions 20.
6. **Patent Registration is in Research and scores 15 points.**
7. **Editorship:** (v1) biannual 10, quarterly 15, monthly not eligible. v2: by journal class FT50 30, A* 25, A 20, B 10, C 5; best 2 journals only. Do not use the Faculty Sheet multipliers.
8. **Indian cases score 2.** International (listed repositories) 30; v2 adds Emerald 10.
9. **Grant sharing:** split equally among participating faculty, then apply tier to each faculty member's share. v2 tiers: ₹50,000–₹2,00,000 → 5; > ₹2,00,000 → 10.
10. **Eligibility:** standard 200; Junior Faculty 30; prorating = days in service ÷ days in the year for new and exiting faculty.
11. **Payment formula:** implement the progressive formula in `SCORING_MAPPING.md`; ₹7,000 and every designation rate are per-academic-year parameters editable in the Admin portal, never UI constants. Final amount rounds up to the next rupee (v2).
12. **Authentication:** Admin uses a configured Admin login. Each Faculty member is selected from the Admin-maintained Faculty Master List and authenticated with a unique system-generated individual secret/access code. Show the raw secret to Admin once for individual distribution; store only its hash. Never use one shared Faculty secret. Rate-limit attempts, support revocation/regeneration, and bind sessions to the validated Faculty Master record. No department SSO is required for the first release.
13. **Email:** send to the email address in the Admin-maintained Faculty Master List. Faculty cannot directly edit it. Faculty can request a correction; Admin must approve it before the master record changes, and direct confirmation from the faculty member is sufficient verification. Record provider responses and support Admin resend. Faculty-specific exports are PDF: email one immediately after submission and a refreshed one after final approval.
14. **SQLite:** never deploy a local SQLite file on ephemeral/serverless storage as durable production data. Use persistent disk or hosted DB.
15. **No destructive edits to historical records.** Preserve submission versions, policy versions, payment history, and audit log.
16. **Every required field remains in exports.** Blank/Nil values remain visible; never omit a field just because it has no value.
17. **Do not seed sample workbook faculty names, emails, payment amounts, or submissions into production.** Seed only lookup/configuration values approved by the owner.

## 3. Engineering conventions

- Use TypeScript strict mode.
- Keep React components presentational and focused.
- Put business logic in server-side services.
- Validate all external input server-side with Zod or equivalent.
- Use Prisma for database access.
- Use database transactions for state changes plus audit records.
- Use decimal-safe arithmetic for points and currency.
- Use explicit enums/keys for designation, status, activity type, and policy keys.
- Avoid `any`; avoid unsafe type assertions.
- Do not duplicate policy values in multiple components.
- Use environment variables for secrets and deployment-specific configuration.
- Keep `.env`, DB files, generated exports, and credentials out of Git.
- Add tests with each feature; do not defer all tests to the end.
- Use accessible labels, keyboard navigation, and actionable validation messages.

## 4. Suggested implementation phases

### Phase 0 — Repository and source audit
- Inspect current repository, package manager, framework version, Prisma version, and deployment target.
- Confirm the source workbooks and generated specification documents are available.
- Record existing code and avoid replacing working infrastructure without reason.
- Confirm whether production is intended for persistent-disk hosting, Vercel + hosted DB, or another topology.
- Produce a concise architecture decision record for SQLite hosting and migration.

**Exit criteria:** repository baseline documented; no application code changed without a plan.

### Phase 1 — Foundation and configuration
- Set up app shell, routes, theme, error handling, environment validation.
- Configure Prisma with SQLite for local development.
- Add schema and initial migration.
- Add seed data for approved designations, activity types, academic year configuration, and policy version.
- Implement the configured Admin login and unique per-faculty secret authentication, with secure sessions bound to Faculty Master records.
- Add role-protected Faculty and Admin layouts.

**Exit criteria:** both role logins work; protected server routes enforce role checks; DB migrations and seed are reproducible.

### Phase 2 — Policy and scoring engine
- Implement policy tables as data/config, not JSX constants.
- Implement R/T/S aggregation and minimum eligibility.
- Implement confirmed publication base points, cases, books, grants, doctoral committee, patent, service points, and zero-point activities.
- Implement author affiliation/contribution logic only for deterministic approved combinations.
- Add review warnings for ambiguous publication cases.
- Implement progressive payment formula with configurable rates.
- Add comprehensive unit tests and golden test cases approved by owner.

**Exit criteria:** calculation test suite passes and every line has an explanation.

### Phase 3 — Faculty submission workflow
- Build Faculty profile, Teaching, Research, Service forms.
- Support repeatable activity rows.
- Add draft save, validation, review summary, declaration, and submission.
- Preserve blank/Nil fields in exported representation.
- Add submission versioning and audit history.

**Exit criteria:** a Faculty user can complete, save, reload, validate, and submit a complete annual record.

### Phase 4 — Admin review and consolidated views
- Build dashboard and submission queue.
- Add detailed review page and line-level verification.
- Add request-clarification, return, approve, reject, and lock transitions.
- Add audited Admin corrections.
- Build Faculty and Junior Faculty consolidated views.
- Add historical payment records and current-year Paid/Corrected/Differential fields.

**Exit criteria:** Admin can process a complete submission lifecycle and see accurate consolidated totals.

### Phase 5 — Export, email and receipt confirmation
- Build versioned PDF export template. The initial (on-submission) PDF shows submitted R/T/S only; the final (post-approval) PDF shows Submitted R/T/S and Approved R/T/S separately, plus independently calculated totals (owner decision 2026-11-22).
- Generate and email the initial PDF immediately after submission; initialize approved points to submitted points.
- Persist six separate category-level values per submission: submitted R/T/S and approved R/T/S. Initialize each approved category from its corresponding submitted category.
- Keep submitted R/T/S immutable. Admin may independently adjust approved R, approved T, and approved S; changing one category must not overwrite submitted values or the other approved categories.
- Derive submitted total and approved total independently from their respective R/T/S values. Preserve activity-level detail and audit every Admin override with category, before/after values, actor, timestamp, and mandatory reason.
- On final approval, lock approved values, generate the final PDF with both point sets, and email it to the Faculty Master email address.
- Add email provider adapter and persisted send attempts.
- Add bounded retries and webhook handling where supported.
- Add Faculty “Did you receive the file export by email?” flow.
- Add Faculty email-correction request flow, Admin approval/rejection, and Admin correction/resend queue. Direct faculty confirmation is sufficient verification for the Admin decision.
- Record receipt confirmation separately from provider acceptance/delivery.

**Exit criteria:** send success, failure, bounce, corrected email, resend, and faculty receipt scenarios pass E2E tests.

### Phase 6 — Hardening and deployment
- Run security review, authorization tests, accessibility checks, and load smoke tests.
- Implement backup/restore and retention policy.
- Choose production persistence architecture.
- If migrating to PostgreSQL, create separate PostgreSQL migration path and perform controlled data migration.
- Configure production secrets, monitoring, error tracking, and operational runbook.
- Run a pilot with a small Admin/faculty group before broad use.

**Exit criteria:** production deployment has durable data, tested restore, auditable workflows, and documented support process.

## 5. Definition of done for every feature

A feature is complete only when:
- Acceptance criteria are written.
- Server-side validation exists.
- Authorization is enforced server-side.
- Loading, empty, success, and error states are implemented.
- Audit logging is added for consequential changes.
- Unit/integration/E2E tests cover critical behavior.
- No secrets or sample personal data are committed.
- Documentation is updated.
- Policy ambiguity is documented instead of silently resolved.

## 6. Required test cases

At minimum:
- Standard faculty minimum 200.
- Junior Faculty minimum 30.
- New faculty prorating at exact boundary dates.
- `pointsPayable = 0`.
- `P < R`, `P = R`, and `P > R` payment branches.
- Grant shares just below, equal to, and just above ₹1 lakh and ₹3 lakh thresholds.
- Indian case = 2; international case = 30.
- Patent registration = 15.
- Biannual editorship = 10; quarterly = 15; monthly = not eligible.
- Conference, reviewing, R&R, empirical/internship guidance = zero scored points.
- Disciplinary Committee activity cannot be entered under v1; scores 10 under v2.
- Faculty Sheet legacy values are not accidentally used.
- Ambiguous publication authorship returns review warning.
- Admin edits are audited.
- Approval locks the reviewed version.
- Email provider accepted vs delivered vs bounced vs faculty-confirmed receipt are not conflated.
- Email address correction and resend create new audit/email-attempt records.
- A Faculty session cannot access Admin endpoints or another faculty member's records; revoked/incorrect faculty secrets are rejected and rate-limited.
- SQLite backup can be restored.
- Production deployment does not persist data to ephemeral local filesystem.

## 7. Do not do these things

- Do not make up missing policy values.
- Do not “simplify” away source spreadsheet fields.
- Do not rely on client-calculated totals.
- Do not store passwords in plaintext or hard-code credentials.
- Do not send email from a request without recording the attempt.
- Do not let Faculty directly overwrite the master email address; correction requires Admin approval.
- Do not store raw faculty access secrets. Show a newly generated secret to Admin only once at issuance/regeneration, then require Admin to distribute it individually.
- Do not mark an email delivered merely because the provider accepted the send request.
- Do not allow Faculty to view consolidated Admin data or another faculty member's records.
- Do not silently recalculate approved records after policy changes.
- Do not use SQLite local disk on Vercel as production storage.
- Do not migrate to PostgreSQL by merely changing `provider` and reusing incompatible migrations.
