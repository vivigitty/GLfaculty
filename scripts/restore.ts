import { loadEnv } from "./loadEnv";
loadEnv();
const { restore } = await import("../src/server/maintenance");

const src = process.argv[2];
if (!src) {
  console.error("Usage: npm run restore -- <backup-folder>   (stop the app first)");
  process.exit(1);
}
const target = process.env.DATA_DIR ?? "./data";
const aside = await restore(src, target);
console.log(`Restored ${src} into ${target}.${aside ? ` Previous data kept at ${aside}.` : ""}`);
