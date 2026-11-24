import { NextResponse } from "next/server";
import { getAuth } from "@/server/auth/session";
import { consolidated, consolidatedCsv } from "@/server/services/payments";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = await getAuth();
  if (!auth || auth.session.role !== "ADMIN") return new NextResponse("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const ay = url.searchParams.get("ay") ?? "";
  const cat = url.searchParams.get("view") === "junior" ? "JUNIOR" : "STANDARD";
  if (!/^AY\d{4}-\d{2}$/.test(ay)) return new NextResponse("Bad request", { status: 400 });
  const csv = consolidatedCsv(await consolidated(ay, cat));
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="RTS_${ay}_${cat === "JUNIOR" ? "Junior_Faculty" : "Faculty"}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
