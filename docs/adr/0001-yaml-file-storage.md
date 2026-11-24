# ADR 0001 — YAML file storage instead of SQLite/Prisma (first release)

**Status:** Accepted (owner preference, 2026-11-22)
**Supersedes:** the "Prisma + SQLite" recommendation in `DESIGN.md` §1–2 and `AGENTS.md` §3 for the first release.

## Context

The owner prefers to keep records as human-readable YAML files, provided the
architecture can save, retrieve and update them safely. Expected volume is
~50 submissions per academic year (plus faculty master records, audit events,
email attempts and payment records — a few thousand small files over many years).

## Decision

Use a file-backed document store (`src/server/store`) that writes one YAML file
per record under `DATA_DIR`. All business code talks to the store through a small
repository interface, so a SQLite/PostgreSQL adapter can replace it later without
touching services, scoring or UI.

Safety mechanisms (all implemented and tested):

| Risk | Mitigation |
|---|---|
| Torn/partial file on crash | Every file is written to a temp file, `fsync`ed, then atomically renamed over the target. |
| Multi-file change half-applied (e.g. submission + audit + version) | A **write-ahead journal**: the full set of writes is first written to `DATA_DIR/_journal.yaml`, then applied, then the journal is removed. On start-up any leftover journal is replayed, so a transaction is all-or-nothing. |
| Concurrent writers | One in-process async mutex plus an exclusive lock file (`_write.lock`, `O_EXCL`, stale-lock recovery) that also blocks a second process (e.g. a backup/restore script). |
| Lost update (two Admins editing the same record) | Every record carries `_rev`; a write must name the revision it read, otherwise it fails with a conflict and the user reloads. |
| Corrupt or hand-edited file | Every read is validated with a Zod schema; invalid files raise an explicit error instead of being silently used. |
| History loss | Submission versions, policy versions, email attempts and audit events are separate immutable files — never overwritten. |
| Backup / restore | `npm run backup` copies `DATA_DIR` to a timestamped folder (point it at storage outside the app host); `npm run restore` restores it. Covered by an automated test. |

## Consequences / constraints

* **Run exactly one application instance** with `DATA_DIR` on a **persistent disk**
  (a VM, a container with a mounted volume, Render/Railway/Fly with a volume, or an
  on-premise server). The app refuses to start on Vercel/serverless unless
  `ALLOW_EPHEMERAL_DATA_DIR=true` is set for a demo.
* No ad-hoc SQL reporting; consolidated views are computed in code (trivial at this volume).
* If volume or concurrency grows (multiple instances, >~10k active records), implement a
  Prisma/PostgreSQL adapter for the same repository interface and migrate with a one-off
  script that reads every YAML file through the same Zod schemas.
