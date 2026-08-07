import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { dbSslConfig } from "../server/db-ssl.mjs";

const direction = process.argv[2] === "down" ? "down" : "up";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL is not set.");
  process.exit(1);
}

/**
 * advisoryLockMode: "wait" rather than the default "fail" — several pods can
 * start at once on a rollout, and only one should apply pending migrations
 * while the rest wait for the lock and then find nothing left to do, instead
 * of crashing on "another migration is already running".
 */
const ssl = dbSslConfig();

try {
  await runner({
    databaseUrl: { connectionString: databaseUrl, ssl },
    dir: `${dirname(fileURLToPath(import.meta.url))}/../migrations`,
    migrationsTable: "pgmigrations",
    direction,
    singleTransaction: true,
    advisoryLockMode: "wait",
    verbose: true,
  });
  console.log(`[migrate] ${direction} completed.`);
} catch (err) {
  console.error("[migrate] Failed:", err.message);
  process.exit(1);
}
