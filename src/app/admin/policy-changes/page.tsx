import Link from "next/link";
import { requireAdmin } from "@/server/auth/session";
import { policyChangeSummaries } from "@/server/services/recompute";
import { Card, Empty, PageHeader } from "@/components/ui";
import { totalOf } from "@/server/scoring/engine";
import { PolicyChangeForm, type CandidateRow, type DraftRow } from "./PolicyChangeForm";

export const metadata = { title: "Policy changes" };
export const dynamic = "force-dynamic";

export default async function PolicyChanges() {
  await requireAdmin();
  const summaries = await policyChangeSummaries();
  return (
    <div className="stack">
      <PageHeader
        title="Policy changes"
        subtitle="When an academic year switches to a different policy version, records already submitted keep their old points until you recompute them here."
      />
      {summaries.length === 0 && (
        <Empty>
          Every submitted record uses its year&apos;s current policy, and all draft holders have been told about the latest change. Change a year&apos;s policy under{" "}
          <Link href="/admin/academic-years">Academic years</Link> or <Link href="/admin/policy">Policy</Link>.
        </Empty>
      )}
      {summaries.map((s) => {
        const candidates: CandidateRow[] = s.candidates.map((c) => ({
          id: c.submission.id,
          name: c.submission.facultySnapshot?.displayName ?? c.submission.facultyId,
          status: c.submission.status,
          fromVersion: c.submission.policyVersion,
          oldPoints: c.oldPoints,
          newPoints: c.newPoints,
          oldTotal: totalOf(c.oldPoints),
          newTotal: totalOf(c.newPoints),
          changedLines: c.changedLines,
          validationIssues: c.validationIssues,
        }));
        const drafts: DraftRow[] = s.drafts.map((d) => ({
          id: d.submission.id,
          name: d.facultyName,
          oldTotal: d.oldPoints ? totalOf(d.oldPoints) : null,
          newTotal: totalOf(d.newPoints),
          notified: d.notified,
        }));
        return (
          <Card key={s.year.id} title={`${s.year.label} — now ${s.year.policyVersion}`} subtitle="Recomputing re-scores the last submitted content, resets approved points to the new submitted points (line reviews are kept where a line's points did not change), reopens approved records for review, and emails each faculty member a PDF with old vs new submitted points.">
            <PolicyChangeForm yearLabel={s.year.label} candidates={candidates} drafts={drafts} />
          </Card>
        );
      })}
    </div>
  );
}
