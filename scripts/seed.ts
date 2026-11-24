import { loadEnv } from "./loadEnv";
loadEnv();
const { db } = await import("../src/server/db");
const { seed, seedDemo } = await import("../src/server/maintenance");

await seed(db());
if (process.argv.includes("--demo")) await seedDemo();
console.log("Seed complete.");
