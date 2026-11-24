import { NextResponse } from "next/server";
import { C, db } from "@/server/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await db().list(C.policies);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
