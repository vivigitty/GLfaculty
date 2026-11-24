# RTS Faculty App — Technical Design
**Version:** 2.2  
**Recommended initial stack:** Next.js App Router + TypeScript + Prisma + SQLite, with a deliberate migration path to PostgreSQL/Supabase.

## 1. Architecture overview

A modular monolith is appropriate for the scale and workflow:
- Next.js UI for Faculty and Admin portals.
- Server-side application/service layer for validation, policy evaluation, approval, export, and email orchestration.
- Prisma as the database access layer.
- SQLite for initial development / controlled deployment with persistent storage.
- Email provider adapter behind a small interface.
- PDF export generator behind a small interface; keep Admin consolidated exports as a separate configurable capability.
- Audit log written transactionally with important state changes.

Do not introduce microservices, a message broker, or a complex workflow engine for the first release.

## 2. Important SQLite and deployment decision

SQLite is a sensible starting point for a small internal app, but deployment topology matters:
- SQLite is a file database. The database file must live on a persistent mounted volume.
- A local SQLite file on Vercel's serverless/ephemeral filesystem is not a durable production database. Deploying the app to Vercel while writing to a local `.db` file risks data loss and inconsistent instances.
- SQLite is best with one application instance and short write transactions. Configure a busy timeout and consider WAL mode where supported.
- Back up the database file to storage outside the app host and test restores.
- If production must remain on Vercel, choose a hosted SQLite-compatible database such as a managed libSQL/Turso service, or switch to PostgreSQL/Supabase.
- Prisma supports both SQLite and PostgreSQL, but changing the Prisma provider is not a magic zero-effort switch. Maintain provider-appropriate migrations and perform a deliberate data migration with validation.

### Recommended deployment choices
**Option A — keep SQLite:** host the Next.js application on a platform with a persistent disk/volume and a single app instance.  
**Option B — deploy on Vercel:** use hosted PostgreSQL (e.g., Supabase) or a hosted SQLite-compatible service; do not store production data in Vercel's local filesystem.

## 3. Suggested project structure

```text
src/
  app/
    (auth)/
      login/
        page.tsx
    faculty/
      submissions/
        page.tsx
        new/page.tsx
        [submissionId]/
          page.tsx
          review/page.tsx
          email-confirmation/page.tsx
    admin/
      dashboard/page.tsx
      submissions/
        page.tsx
        [submissionId]/page.tsx
      faculty/page.tsx
      payments/page.tsx
      policy/page.tsx
      email-issues/page.tsx
    api/
      auth/
      email/
        webhook/route.ts
  components/
    forms/
    tables/
    scoring/
    status/
    layout/
  lib/
    auth/
    db/
    email/
    exports/
    validation/
    config/
  server/
    actions/
    services/
    repositories/
    policies/
      scoring/
      teaching/
      payment/
    audit/
prisma/
  schema.prisma
  migrations/
  seed.ts
tests/
  unit/
  integration/
  e2e/
```

Keep business rules out of React components and route handlers. Components collect and display data; service functions own calculations and state transitions.

## 4. Core modules

### 4.1 Authentication module
- Admin uses a configured Admin credential.
- Faculty selects a record from the Admin-maintained Faculty Master List and enters a unique individual secret/access code.
- Generate each faculty secret using a cryptographically secure random generator. Display it to Admin once on issue/regeneration for individual distribution; store only its strong hash and never redisplay it.
- Support system generation, one-time Admin display, revoke/regenerate operations, rate-limit failed attempts, and use generic errors that do not disclose whether the selected name or secret was wrong.
- Establish a server-side session bound to the validated Faculty Master record.
- Session cookie signed with a strong secret; HttpOnly, Secure in production, SameSite=Lax or Strict.
- Enforce faculty-record ownership on every protected route/action. Never let a client-supplied `role` or `facultyId` establish authorization.

### 4.2 Submission module
- Create draft, update draft, submit, return for clarification, resubmit, approve, reject, lock.
- Validate all data on the server using Zod or equivalent.
- Use transactions to persist submission state and audit entries.
- Maintain six explicit category-level values per submission: submitted R/T/S and approved R/T/S (`submitted_r_points`, `submitted_t_points`, `submitted_s_points`, `approved_r_points`, `approved_t_points`, `approved_s_points`).
- On submission, initialize approved R/T/S from the matching submitted R/T/S values. Submitted values are immutable; Admin can independently adjust approved R, approved T, and approved S without changing submitted values or the other categories.
- Calculate submitted total and approved total independently as their respective R + T + S sums. Never reuse a single category subtotal or total for both views.
- Preserve activity-level submitted entries and any approved adjustments separately for traceability. Every Admin adjustment records category, old value, new value, actor, timestamp, and mandatory reason. Final approval locks the approved R/T/S snapshot; post-approval edits require an explicit reopen/amendment action.
- A new academic-year submission must be a distinct record.

### 4.3 Scoring engine
- Pure deterministic functions, no database writes inside calculation functions.
- Input: normalized submission data + policy snapshot.
- Output: line-level calculation details, category totals, eligibility, points payable, payment estimate, warnings requiring Admin review.
- Version every policy table.
- Do not embed score values in UI components.
- Do not use the Faculty Sheet `Sheet3` multipliers.
- For ambiguous publication contribution cases, return `NEEDS_ADMIN_REVIEW` rather than guessing.

Suggested service contracts:

```ts
type ScoreInput = {
  submission: NormalizedSubmission;
  policy: PolicySnapshot;
};

type ScoreLine = {
  activityId: string;
  category: "R" | "T" | "S";
  basePoints: Decimal;
  multiplier: Decimal;
  awardedPoints: Decimal;
  compensationEligible: boolean;
  explanation: string;
  reviewRequired: boolean;
};

type ScoreResult = {
  lines: ScoreLine[];
  researchPoints: Decimal;
  teachingPoints: Decimal;
  servicePoints: Decimal;
  earnedPoints: Decimal;
  minimumPoints: Decimal;
  pointsPayable: Decimal;
  paymentAmount: Decimal;
  warnings: string[];
};
```

Use Decimal arithmetic for points/currency where fractional values occur; avoid binary floating-point for financial calculations.

### 4.4 Email module
Define a provider-independent interface:

```ts
interface EmailProvider {
  send(input: {
    to: string;
    subject: string;
    text: string;
    html?: string;
    attachments?: Array<{ filename: string; content: Uint8Array; contentType: string }>;
    idempotencyKey: string;
  }): Promise<{
    accepted: boolean;
    providerMessageId?: string;
    errorCode?: string;
    errorMessage?: string;
  }>;
}
```

Email state model:
- `QUEUED`
- `SEND_ACCEPTED`
- `DELIVERED` (only with provider event confirmation)
- `BOUNCED`
- `FAILED`
- `FACULTY_CONFIRMED_RECEIPT`

Keep each attempt as a separate row. Store provider message ID and correlate webhooks. Verify webhook signatures and make webhook processing idempotent.

### 4.5 Export module
- Generate from a stable template version.
- Include every required field; blank/Nil values remain visible.
- Generate only on server.
- Store file metadata and protected storage reference.
- Ensure the file access URL is authenticated or signed and expires.
- Avoid public, guessable object paths.
- Store export checksum and creation timestamp.
- Faculty-specific export format is PDF. Generate/email an initial PDF immediately after submission and a refreshed final PDF after Admin approval. The initial PDF shows only the submitted values; the final PDF shows Submitted R, T, S and total alongside Approved R, T, S and total, reflecting Admin overrides (owner decision 2026-11-22). Admin consolidated export format can be selected separately.

### 4.6 Audit module
Record:
- actor role and actor identifier (`FACULTY_ROLE`, `ADMIN_ROLE`, or system)
- action
- entity type and ID
- timestamp
- before/after JSON or safe diff
- reason/comment
- request correlation ID where available

Audit events include submission edits after initial save, submit, Admin return, Admin correction, approval/rejection, policy changes, email correction, email resend, payment corrections, and export generation.

## 5. Data model (logical)

Use normalized tables. Names are illustrative; refine after policy sign-off.

### `AcademicYear`
- id
- label
- startDate
- endDate
- submissionOpenAt
- submissionCloseAt
- status

### `FacultyProfile` (Admin-maintained Faculty Master List)
- id
- displayName
- normalizedName (optional)
- designationKey
- facultyCategory (`STANDARD` / `JUNIOR`)
- dateOfJoining
- emailAddress
- accessSecretHash
- accessStatus (`ACTIVE` / `REVOKED` / `PENDING_ISSUE`)
- active
- createdAt / updatedAt

This is the authoritative identity record. Faculty cannot edit its name, designation, or email. Only Admin can update master data. Faculty email correction requests are stored separately and require Admin approval; direct confirmation from the faculty member is sufficient verification for Admin review.

### `Submission`
- id
- academicYearId
- facultyProfileId
- status
- submittedAt
- approvedAt
- approvedByRole
- currentVersion
- policyVersionId
- facultyDeclaration
- facultyNotes
- submittedPointsSnapshot (immutable after submission)
- approvedPointsSnapshot (initialized from submitted snapshot; Admin-editable until final approval)
- adminNotes
- createdAt / updatedAt

### `SubmissionVersion`
- id
- submissionId
- versionNumber

### `SubmissionScoreLine`
- id
- submissionId
- activityLineId (or stable source-line key)
- submittedPoints (immutable after submission)
- approvedPoints (initialized equal to submittedPoints)
- adminOverrideReason (nullable until overridden)
- updatedByAdminId / updatedAt

Keep submitted and approved values distinct in storage and calculations. Derive submitted totals only from submitted values and approved totals only from approved values; never replace the submitted figure when Admin adjusts an approved figure.
- snapshotJson
- createdByRole
- createdAt
- changeReason

### `TeachingActivity`
- id
- submissionId
- courseName
- sections
- studentCount
- studentFeedback (nullable Decimal)
- pgpmHours
- pgdmYear2Hours
- pgdmYear1Hours
- flexHours
- xpmHours
- fpmHours
- cldHours
- otherHours
- calculatedTotalHours

### `ResearchActivity`
- id
- submissionId
- activityType
- subtype
- title
- venueOrPublisher
- journalRank
- publicationDate
- doiOrUrl
- repository
- authorCount
- facultyAuthorOrder
- equalContribution
- affiliationBreakdownJson
- grantTotalAmount
- facultyShareAmount
- participantCount
- evidenceFileId
- adminVerificationStatus
- facultyNotes

Use explicit activity subtypes for publication, R&R, review, editorship, book, case, conference, grant, patent, and doctoral committee work. Avoid a single opaque JSON blob for all core fields; JSON may hold variable author details.

### `ServiceActivity`
- id
- submissionId
- serviceType
- roleKey
- quantity
- startDate
- endDate
- description
- evidenceFileId
- adminVerificationStatus

### `PolicyVersion`
- id
- versionLabel
- effectiveFrom
- effectiveTo
- status
- createdBy
- approvedBy
- createdAt

### `PolicyRule`
- id
- policyVersionId
- category
- activityKey
- points
- compensationEligible
- ruleJson
- effectiveFrom
- effectiveTo

### `ScoringResult`
- id
- submissionId
- submissionVersionId
- policyVersionId
- researchPoints
- teachingPoints
- servicePoints
- earnedPoints
- minimumPoints
- pointsPayable
- paymentEstimate
- calculationJson
- calculatedAt

### `ExportFile`
- id
- submissionId
- submissionVersionId
- format
- templateVersion
- storageKey
- checksum
- generatedAt
- generatedByRole

### `EmailAttempt`
- id
- submissionId
- exportFileId
- recipientEmail
- attemptNumber
- status
- providerMessageId
- errorCode
- errorMessage
- queuedAt
- acceptedAt
- deliveredAt
- bouncedAt

### `EmailReceiptConfirmation`
- id
- submissionId
- emailAttemptId
- confirmation (`YES_RECEIVED` / `NO_NOT_RECEIVED`)
- addressShown
- confirmedAt
- followUpOutcome
- notes

### `FacultyEmailCorrectionRequest`
- id
- facultyProfileId
- oldEmailAddress
- requestedEmailAddress
- facultyExplanation
- status (`PENDING` / `APPROVED` / `REJECTED`)
- reviewedByRole
- reviewReason
- requestedAt
- reviewedAt

Only Admin approval updates `FacultyProfile.emailAddress`; preserve the old address in the audit log.

### `PaymentRecord`
- id
- facultyProfileId
- academicYearId
- expectedAmount
- paidAmount
- correctedAmount
- differentialAmount
- paymentReference
- notes
- updatedByRole
- updatedAt

### `AuditLog`
- id
- actorRole
- actorReference
- action
- entityType
- entityId
- beforeJson
- afterJson
- reason
- createdAt

## 6. Main API / server-action boundaries

Use server actions or route handlers consistently. Example logical operations:
- `POST /auth/login`
- `POST /auth/logout`
- `POST /faculty/submissions`
- `PATCH /faculty/submissions/:id/draft`
- `POST /faculty/submissions/:id/submit`
- `POST /faculty/submissions/:id/email-receipt`
- `POST /faculty/email-correction-requests`
- `POST /admin/faculty/:id/email-correction-requests/:requestId/approve`
- `POST /admin/faculty/:id/email-correction-requests/:requestId/reject`
- `GET /admin/submissions`
- `GET /admin/submissions/:id`
- `POST /admin/submissions/:id/request-clarification`
- `POST /admin/submissions/:id/approve`
- `POST /admin/submissions/:id/reject`
- `PATCH /admin/submissions/:id`
- `POST /admin/submissions/:id/export`
- `POST /admin/submissions/:id/resend-email`
- `POST /admin/email/webhook`
- `GET /admin/payments`
- `PATCH /admin/payments/:id`
- `GET /admin/export/consolidated`

Every operation must check role and submission state server-side.

## 7. Faculty UX flow

1. Select their name from the Faculty Master dropdown.
2. Enter their unique individual secret/access code.
3. On successful validation, the app loads the Faculty Master identity (name, designation, email and eligibility details).
4. Choose open academic year.
4. Complete Teaching, Research, and Service sections.
5. Save draft; show category totals and missing required fields.
6. Review all entered data and calculation explanation.
7. Submit declaration.
8. Show receipt and submission reference.
9. Generate and email the initial PDF immediately after submission; show the submitted R/T/S only (approved values appear in the final PDF after approval).
10. Display “Did you receive the file export by email?”
    - Yes → record confirmation and finish.
    - No → show destination address and allow verification.
    - Address wrong → submit an email correction request; the master address remains unchanged until Admin approves it.
    - Address correct but not received → advise spam/junk check and create an Admin follow-up issue.
    - Admin may accept the faculty member's direct confirmation as sufficient verification. After approval, Admin can resend the latest PDF to the newly approved address.
11. Show a safe direct-download option if enabled.

Faculty sessions are bound to the validated Faculty Master record. Enforce ownership on every read/write. The Faculty portal must not provide a browse-all-submissions endpoint or expose other faculty records.

## 8. Admin UX flow

1. Login as Admin.
2. Dashboard shows counts: Draft (optional), Submitted, Under Review, Needs Clarification, Approved, Rejected, email unresolved, failed/bounced.
3. Open submission and inspect profile, R/T/S activities, evidence, scoring lines, and policy version.
4. Mark activity verified / disputed / needs evidence.
5. Correct values only with reason; audit before/after.
6. Compare submitted R, T, and S values separately with approved R, T, and S values. Admin may independently change each approved category; submitted values remain unchanged and every override requires a reason.
7. On final approval, lock the approved snapshot, generate the final PDF showing submitted R/T/S and approved R/T/S separately, with independently calculated totals, and email it to the current Faculty Master email address.
8. Resolve email issues and resend.
9. Update payment records and export consolidated Faculty / Junior Faculty sheets.

## 9. SQLite-to-PostgreSQL migration strategy

- Start with Prisma SQLite provider for local/dev or a persistent-disk single-instance environment.
- Avoid SQLite-only raw SQL in business logic.
- Keep schema types portable: strings, integers, booleans, dates, decimals with explicit serialization, and normalized relations.
- Use a migration branch for PostgreSQL: update Prisma datasource provider, generate PostgreSQL migrations, provision target DB, migrate data with a one-off script, compare row counts and critical aggregates, and run the full test suite.
- Do not point the SQLite app at a PostgreSQL URL or assume existing migrations can be replayed unchanged.
- Test backup/restore and rollback before cutover.
- If using Supabase PostgreSQL, configure pooled/direct connection URLs appropriately for the deployment runtime and use least-privilege credentials.

## 10. Testing strategy

### Unit tests
- Each scoring rule and boundary.
- Publication base points and co-author deterministic cases.
- Ambiguous contribution combinations return Admin-review warnings.
- Grant share calculation and tier boundaries.
- Minimum eligibility and prorating.
- Progressive payment formula.
- Teaching load and cap calculations.
- Email status transition rules.

### Integration tests
- Draft save and reload.
- Submit transaction + audit event.
- Admin correction + audit event.
- Approval locks the approved version.
- Export references correct version.
- Email send failure and retry.
- Email correction and resend.
- Webhook signature/idempotency.
- Faculty receipt confirmation.
- Consolidated Admin totals.

### End-to-end tests
- Faculty completes and submits a record.
- Admin reviews and approves.
- Export is generated and emailed.
- Faculty confirms receipt.
- Faculty reports not received and corrects address.
- Admin corrects/resends.
- Junior Faculty eligibility.
- Access-control checks for unique faculty secrets, faculty-record ownership, secret revocation, and Admin-only email corrections.

## 11. Operational considerations

- Keep secrets in deployment environment variables.
- Do not commit `.env` files or database files to Git.
- Add structured server logs without logging passwords, full evidence contents, or unnecessary personal data.
- Back up persistent database and exports.
- Configure retention for exports and email metadata.
- Add health checks and error monitoring.
- Document restore procedure and migration runbook.
- Use a single production database source of truth; do not use local developer SQLite copies as production data.
