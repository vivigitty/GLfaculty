import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw || pw.length < 12) {
  console.error('Usage: npm run hash-password -- "a-strong-password-of-12+-chars"');
  process.exit(1);
}
const hash = await bcrypt.hash(pw, 12);
// $ signs must be escaped in .env files read by Next.js (dotenv-expand).
console.log(`ADMIN_LOGIN_PASSWORD_HASH=${hash.replace(/\$/g, "\\$")}`);
