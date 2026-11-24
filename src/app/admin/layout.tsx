import { requireAdmin } from "@/server/auth/session";
import { Shell } from "@/components/Shell";

export const dynamic = "force-dynamic";

const LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/submissions", label: "Submissions" },
  { href: "/admin/payments", label: "Consolidated & payments" },
  { href: "/admin/email-issues", label: "Email issues" },
  { href: "/admin/faculty", label: "Faculty master" },
  { href: "/admin/academic-years", label: "Academic years" },
  { href: "/admin/policy", label: "Policy" },
  { href: "/admin/audit", label: "Audit log" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { actor } = await requireAdmin();
  return (
    <Shell who={actor.ref} role="Admin" links={LINKS}>
      {children}
    </Shell>
  );
}
