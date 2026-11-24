import { z } from "zod";

const schema = z.object({
  DATA_DIR: z.string().default("./data"),
  ALLOW_EPHEMERAL_DATA_DIR: z.enum(["true", "false"]).default("false"),
  ADMIN_LOGIN_USERNAME: z.string().default("admin"),
  ADMIN_LOGIN_PASSWORD_HASH: z.string().default(""),
  SESSION_SECRET: z.string().default(""),
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(120),
  EMAIL_PROVIDER: z.enum(["outbox", "smtp"]).default("outbox"),
  EMAIL_FROM: z.string().default("RTS Office <rts@example.edu>"),
  ADMIN_NOTIFY_EMAIL: z.string().default(""),
  SMTP_HOST: z.string().default(""),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(""),
  SMTP_PASSWORD: z.string().default(""),
  EMAIL_WEBHOOK_SECRET: z.string().default(""),
  APP_BASE_URL: z.string().default("http://localhost:3000"),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function env(): Env {
  if (cached && process.env.NODE_ENV !== "test") return cached;
  const parsed = schema.parse(process.env);
  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
  if (isServerless && parsed.ALLOW_EPHEMERAL_DATA_DIR !== "true") {
    throw new Error(
      "Refusing to start: YAML data store needs a persistent disk, but this looks like a serverless host. " +
        "See docs/adr/0001-yaml-file-storage.md.",
    );
  }
  if (parsed.NODE_ENV === "production") {
    if (parsed.SESSION_SECRET.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters in production.");
    if (!parsed.ADMIN_LOGIN_PASSWORD_HASH) throw new Error("ADMIN_LOGIN_PASSWORD_HASH is required in production.");
  }
  cached = parsed;
  return parsed;
}

export function sessionSecret(): string {
  const s = env().SESSION_SECRET;
  if (s.length >= 32) return s;
  if (env().NODE_ENV === "production") throw new Error("SESSION_SECRET missing");
  return "development-only-session-secret-change-me-0000";
}
