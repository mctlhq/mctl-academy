import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/**
 * initDb() throwing in-process is covered indirectly by app.mjs importing it
 * at module load — but the interesting behaviour is what happens to the
 * *process*, which only a subprocess can observe. This is the regression test
 * for "the pod appears healthy and quietly loses data": in production, an
 * app that cannot reach Postgres must not start serving traffic at all.
 */
describe("production refuses to boot without a working database", () => {
  test("DATABASE_URL unset in production exits non-zero and never starts serving", () => {
    const result = spawnSync(process.execPath, ["server/index.mjs"], {
      cwd: repoRoot,
      env: { ...process.env, NODE_ENV: "production", DATABASE_URL: "", PORT: "0" },
      timeout: 5000,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0, "process must exit non-zero, not fall back to memory");
    assert.match(result.stderr, /DATABASE_URL is not set in production/);
  });

  test("an unreachable DATABASE_URL in production exits non-zero", () => {
    const result = spawnSync(process.execPath, ["server/index.mjs"], {
      cwd: repoRoot,
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://nobody:nothing@127.0.0.1:1/does-not-exist",
        PORT: "0",
      },
      // Kept comfortably above the app's own 5000ms connectionTimeoutMillis
      // so a slow-refusing loopback connection can't race the process's own
      // graceful error-and-exit against spawnSync's SIGTERM.
      timeout: 8000,
      encoding: "utf8",
    });

    assert.notEqual(result.status, 0, "a connection failure must be fatal, not a silent fallback to memory");
    assert.match(result.stderr, /Migration failed in production/);
  });

  test("outside production, a missing DATABASE_URL still starts on the in-memory store", () => {
    const result = spawnSync(process.execPath, ["server/index.mjs"], {
      cwd: repoRoot,
      env: { ...process.env, NODE_ENV: "development", DATABASE_URL: "", PORT: "0" },
      timeout: 2000,
      encoding: "utf8",
    });

    // The server has no shutdown hook, so it is still running when the
    // timeout kills it — SIGTERM, not a self-triggered exit, is the pass case.
    assert.equal(result.signal, "SIGTERM");
    assert.match(result.stdout, /DATABASE_URL not set — using in-memory store/);
  });
});
