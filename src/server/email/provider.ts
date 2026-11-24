import path from "node:path";
import { promises as fs } from "node:fs";
import nodemailer from "nodemailer";
import { env } from "../env";

export type SendInput = {
  to: string;
  subject: string;
  text: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  idempotencyKey: string;
};
export type SendResult = {
  accepted: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  /** Permanent failures (e.g. invalid recipient) must not be retried. */
  permanent?: boolean;
};

export interface EmailProvider {
  readonly name: string;
  send(input: SendInput): Promise<SendResult>;
}

/**
 * Development provider: writes the full .eml message to DATA_DIR/outbox.
 * Recipients on the reserved `.invalid` TLD are rejected permanently and
 * `.test` addresses fail transiently, so failure paths can be exercised.
 */
class OutboxProvider implements EmailProvider {
  readonly name = "outbox";
  async send(input: SendInput): Promise<SendResult> {
    const domain = input.to.split("@")[1]?.toLowerCase() ?? "";
    if (domain.endsWith(".invalid")) return { accepted: false, errorCode: "INVALID_RECIPIENT", errorMessage: "Recipient address rejected (simulated).", permanent: true };
    if (domain.endsWith(".test")) return { accepted: false, errorCode: "TEMPORARY_FAILURE", errorMessage: "Provider temporarily unavailable (simulated).", permanent: false };
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    const info = await transport.sendMail({ from: env().EMAIL_FROM, to: input.to, subject: input.subject, text: input.text, attachments: input.attachments, headers: { "X-Idempotency-Key": input.idempotencyKey } });
    const dir = path.resolve(env().DATA_DIR, "outbox");
    await fs.mkdir(dir, { recursive: true });
    const safe = input.idempotencyKey.replace(/[^A-Za-z0-9_.-]/g, "_");
    await fs.writeFile(path.join(dir, `${Date.now()}-${safe}.eml`), info.message as Buffer);
    return { accepted: true, providerMessageId: info.messageId };
  }
}

class SmtpProvider implements EmailProvider {
  readonly name = "smtp";
  async send(input: SendInput): Promise<SendResult> {
    const e = env();
    const transport = nodemailer.createTransport({
      host: e.SMTP_HOST,
      port: e.SMTP_PORT,
      secure: e.SMTP_PORT === 465,
      auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD } : undefined,
    });
    try {
      const info = await transport.sendMail({ from: e.EMAIL_FROM, to: input.to, subject: input.subject, text: input.text, attachments: input.attachments, headers: { "X-Idempotency-Key": input.idempotencyKey } });
      if (info.rejected.length > 0) return { accepted: false, errorCode: "REJECTED", errorMessage: `Rejected: ${info.rejected.join(", ")}`, permanent: true };
      return { accepted: true, providerMessageId: info.messageId };
    } catch (err) {
      const x = err as { responseCode?: number; code?: string; message?: string };
      const permanent = typeof x.responseCode === "number" && x.responseCode >= 500;
      return { accepted: false, errorCode: x.code ?? String(x.responseCode ?? "SMTP_ERROR"), errorMessage: x.message ?? "SMTP error", permanent };
    }
  }
}

let override: EmailProvider | null = null;
/** Test hook. */
export function setEmailProvider(p: EmailProvider | null) {
  override = p;
}

export function emailProvider(): EmailProvider {
  if (override) return override;
  return env().EMAIL_PROVIDER === "smtp" ? new SmtpProvider() : new OutboxProvider();
}
