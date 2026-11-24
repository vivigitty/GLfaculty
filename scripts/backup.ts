import { loadEnv } from "./loadEnv";
loadEnv();
const { db } = await import("../src/server/db");
const { backup } = await import("../src/server/maintenance");

const dest = process.argv[2] ?? process.env.BACKUP_DIR ?? "./backups";
const out = await backup(db(), dest);
console.log(`Backup written to ${out}\nCopy it to storage outside this server (and test a restore periodically).`);
