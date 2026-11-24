import { requireAdmin } from "@/server/auth/session";
import { listFaculty } from "@/server/services/faculty";
import { currentPolicy } from "@/server/services/config";
import { PageHeader } from "@/components/ui";
import { designationLabel } from "@/lib/policyView";
import { FacultyManager } from "./FacultyManager";

export const metadata = { title: "Faculty master" };

export default async function FacultyPage() {
  await requireAdmin();
  const [faculty, policy] = await Promise.all([listFaculty(), currentPolicy()]);
  return (
    <div className="stack">
      <PageHeader title="Faculty master list" subtitle="The authoritative identity record for each faculty member. Faculty sign in by choosing their name and entering their personal access code." />
      <FacultyManager
        designations={policy.designations.items.map((d) => ({ key: d.key, label: d.label, facultyCategory: d.facultyCategory }))}
        statuses={policy.researchStatuses.map((s) => ({ key: s.key, label: s.label }))}
        rows={faculty.map((f) => ({
          id: f.id,
          rev: f._rev,
          displayName: f.displayName,
          email: f.email,
          designationKey: f.designationKey,
          designationLabel: designationLabel(policy, f.designationKey),
          facultyCategory: f.facultyCategory,
          dateOfJoining: f.dateOfJoining,
          researchStatus: f.researchStatus,
          employeeId: f.employeeId,
          dateOfExit: f.dateOfExit ?? null,
          active: f.active,
          accessStatus: f.access.status,
          issuedAt: f.access.issuedAt,
        }))}
      />
    </div>
  );
}
