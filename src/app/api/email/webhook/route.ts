import { NextResponse } from "next/server";
import { z } from "zod";
import { applyProviderEvent, verifyWebhookSignature } from "@/server/services/email";

export const dynamic = "force-dynamic";

/**
 * Generic delivery/bounce webhook. Body:
 *   { "eventId": "...", "providerMessageId": "<...>", "event": "delivered" | "bounced", "detail": "..." }
 * Header `x-rts-signature`: hex HMAC-SHA256 of the raw body using EMAIL_WEBHOOK_SECRET.
 * Adapt this route to your provider's payload format when one is chosen.
 */
const body = z.object({ eventId: z.string().min(1).max(200), providerMessageId: z.string().min(1).max(500), event: z.enum(["delivered", "bounced"]), detail: z.string().max(1000).optional() });

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyWebhookSignature(raw, req.headers.get("x-rts-signature"))) return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  let parsed;
  try {
    parsed = body.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }
  const result = await applyProviderEvent(parsed);
  return NextResponse.json({ result });
}
