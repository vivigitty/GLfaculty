# RTS Faculty Portal

Web application replacing the RTS (Research, Teaching, Service) spreadsheets: faculty submit their
annual activity, points are calculated on the server from a versioned policy, Admin reviews and
approves, PDFs are generated and emailed, and consolidated Faculty / Junior Faculty sheets are
derived automatically.

Specs: `REQUIREMENTS.md`, `SCORING_MAPPING.md`, `DESIGN.md`, `AGENTS.md`.
Storage decision: `docs/adr/0001-yaml-file-storage.md`. Unresolved policy items: `docs/OPEN_QUESTIONS.md`.

## Quick start (local)

```powershell
npm install
copy .env.example .env.local      # then fill in the values (see below)
npm run hash-password -- "choose-a-long-admin-password"   # paste the output into .env.local
npm run seed                      # installs policy + academic year
npm run dev                       # http://localhost:3000
```

`npm run seed -- --demo` additionally creates three **fictional** demo faculty and writes their
access codes to `data/DEMO_ACCESS_CODES.txt` (refused when `NODE_ENV=production`).

| Command | Purpose |
|---|---|
| `npm test` | Unit + integration tests (scoring, YAML store safety, full workflow, backup/restore) |
| `npm run typecheck` | TypeScript strict check |
| `npm run build` / `npm start` | Production build / server |
| `npm run backup -- <folder>` | Consistent copy of the data directory (taken under the write lock) |
| `npm run restore -- <backup>` | Validates every record, moves current data aside, restores (stop the app first) |

## How changes are made ("parameterized")

| To change… | Edit | Code change? |
|---|---|---|
| Any point value, rate, minimum, grant tier, contribution factor, sign-off flag | **Admin → Policy → Edit values as new version** (choose the academic year to use it for). Or a new `config/policy/<version>.yaml` + `npm run seed` | No |
| Add/remove a research field, option or whole research section | `researchSections` in the policy YAML — the form, validation, PDF and review screens render from it | No (new *scoring rule types* need code) |
| Add a service role or unscored disclosure | `service.roles` / `service.disclosures` in the policy YAML | No |
| Teaching programme columns | `teaching.columns` | No |
| Designations and their rates | `designations.items` | No |
| Email wording, retries, feature flags, notifications | `config/app.yaml` | No |
| Submission windows, which policy a year uses | Admin → Academic years | No |

Policy versions are immutable once installed, so approved submissions are never silently recalculated.
Editing from the portal always creates a new version (audited with a value-by-value diff). A year's
policy can change only while nothing has been submitted for it; drafts follow the year. To prepare
next year, open the current version, choose **Edit values as new version**, name it e.g. `2026-27.v1`
and assign it to the new academic year.
Values marked `signoff: PENDING` are used but raise an Admin-review warning; the Admin can mark them
Confirmed in the editor once the owner decides. Current policy: `2025-26.v2` (Nov 2026 points revision).

## Architecture

```
src/
  app/            Next.js pages (faculty/, admin/), server actions (actions/), API routes (api/)
  components/     Presentational React components
  lib/            Formatting + pure policy helpers shared with the browser
  server/
    store/        YAML file store (atomic writes, journal, lock, revisions)
    domain/       Zod schemas for every record type
    policy/       Policy schema + loader
    scoring/      Pure scoring engine + validation (no I/O)
    services/     Business logic: submissions, review, exports, email, payments, faculty
    auth/         Admin login, per-faculty access codes, sessions, rate limiting
    exports/      PDF template
    email/        Provider adapter (outbox for dev, SMTP for production)
config/           policy/*.yaml and app.yaml
data/             Runtime records (gitignored) — one YAML file per record
tests/            unit/ and integration/
```

### Data storage (YAML)
Each record is a YAML file under `DATA_DIR/<collection>/<id>.yaml` — readable, diffable and easy to
back up. Safety comes from atomic write-then-rename, a write-ahead journal for multi-file changes,
a process + file write lock, `_rev` optimistic concurrency, and schema validation on every read and
write. **Requirement:** run a single app instance with `DATA_DIR` on a persistent disk; the app
refuses to start on serverless hosts. All services go through one store interface, so a database
adapter can be added later if volume grows.

### Security
- Admin: username + bcrypt hash from environment variables.
- Faculty: pick name + individual system-generated access code (shown to Admin once; only a bcrypt
  hash is stored). Regenerate/revoke invalidates existing sessions. 5 failures → 15-minute lockout.
  Errors never reveal which part was wrong.
- Server-side sessions (signed HttpOnly SameSite=Strict cookie), role and ownership checks in every
  action and route; server actions include Next.js origin checking (CSRF).
- PDFs are served only through an authenticated route; no public file paths.

### Email
`EMAIL_PROVIDER=outbox` writes `.eml` files to `data/outbox` (dev). In outbox mode, addresses on
`.invalid` fail permanently and `.test` fail transiently, to exercise those paths. `smtp` sends for
real. Every attempt is its own record; provider acceptance is recorded as `SEND_ACCEPTED`, never as
delivered. Delivery/bounce events arrive via `POST /api/email/webhook` (HMAC-signed with
`EMAIL_WEBHOOK_SECRET`; adapt the payload mapping to the chosen provider).

## Deployment checklist
- Host with a persistent volume (VM, on-prem server, or a container platform with a volume); one instance.
- `NODE_ENV=production`, strong `SESSION_SECRET` (32+ chars), `ADMIN_LOGIN_PASSWORD_HASH`, HTTPS.
- Schedule `npm run backup` to storage **outside** the server and test `npm run restore` periodically.
- Do not use `--demo`; do not import sample workbook names/emails/amounts.
