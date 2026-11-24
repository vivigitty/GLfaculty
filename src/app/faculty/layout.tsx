import { requireFaculty } from "@/server/auth/session";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

export default async function FacultyLayout({ children }: { children: React.ReactNode }) {
  const { faculty } = await requireFaculty();
  return (
    <Shell who={faculty.displayName} role="Faculty" links={[{ href: "/faculty", label: "My submissions" }]}>
      {children}
    </Shell>
  );
}
