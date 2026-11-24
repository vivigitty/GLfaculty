import { NextResponse } from "next/server";
import { getAuth } from "@/server/auth/session";
import { C, db } from "@/server/db";
import type { ExportFile, Submission } from "@/server/domain/schemas";
import { appConfig } from "@/server/services/config";

export const dynamic = "force-dynamic";

/** Authenticated PDF download: Admin, or the owning faculty member when direct download is enabled. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return new NextResponse("Not signed in", { status: 401 });
  const { id } = await params;
  if (!/^[A-Za-z0-9_.-]{1,120}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const exp = await db().get<ExportFile>(C.exports, id);
  if (!exp) return new NextResponse("Not found", { status: 404 });
  if (auth.session.role === "FACULTY") {
    const sub = await db().get<Submission>(C.submissions, exp.submissionId);
    const cfg = await appConfig();
    if (!sub || sub.facultyId !== auth.faculty?.id || !cfg.features.facultyDirectDownload) return new NextResponse("Not found", { status: 404 });
  }
  const file = await db().readFile(exp.storageKey);
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${exp.fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
