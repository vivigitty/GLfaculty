import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const BCRYPT_COST = 12;
// Unambiguous alphabet (no 0/O, 1/I/L) so codes can be read out or typed reliably.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 20 random characters (~98 bits) grouped as XXXXX-XXXXX-XXXXX-XXXXX. */
export function generateAccessCode(): string {
  const bytes = crypto.randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
    if (i % 5 === 4 && i < 19) out += "-";
  }
  return out;
}

/** Codes are compared case-insensitively and ignoring spaces/dashes. */
export function normalizeAccessCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function hashSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, BCRYPT_COST);
}

export async function verifySecret(secret: string, hash: string | null): Promise<boolean> {
  // Always run a bcrypt compare so timing does not reveal whether a hash exists.
  const target = hash ?? "$2b$12$C6UzMDM.H6dfI/f/IKcEeO5dNvTIRrS6Uf0nP6Ds1xGq5h0Wq0n6K";
  const ok = await bcrypt.compare(secret, target);
  return ok && hash !== null;
}
