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

  test("a missing DATABASE_URL is fatal outside production too, since better-auth has no in-memory fallback", () => {
    const result = spawnSync(process.execPath, ["server/index.mjs"], {
      cwd: repoRoot,
      env: { ...process.env, NODE_ENV: "development", DATABASE_URL: "", PORT: "0" },
      timeout: 5000,
      encoding: "utf8",
    });

    // initDb() now requires DATABASE_URL in every environment, not just
    // production — unlike the legacy hand-rolled auth it replaced,
    // better-auth (server/auth.mjs) has no in-memory fallback of its own, so
    // there's no environment left where the app can usefully boot without one.
    assert.notEqual(result.status, 0, "process must exit non-zero, not fall back to memory");
    assert.match(result.stderr, /DATABASE_URL is not set\. Refusing to start/);
  });

  test("BETTER_AUTH_SECRET unset in production is fatal — otherwise better-auth signs cookies with its public dev default", () => {
    // Isolated to assertAuthSecretConfigured() itself, not a full server
    // boot: NODE_ENV=production forces SSL for the real DB connection (see
    // db-ssl.mjs), which the plain, non-SSL Postgres this test suite runs
    // against doesn't support — going through index.mjs would fail on that
    // SSL handshake before ever reaching this check, testing the wrong thing.
    // This check has no DB dependency at all (pg.Pool doesn't connect at
    // construction), so importing server/auth.mjs directly is sufficient and
    // avoids that confound entirely.
    const result = spawnSync(
      process.execPath,
      [
        "-e",
        `import("./server/auth.mjs").then(({ assertAuthSecretConfigured }) => {
           assertAuthSecretConfigured();
           console.log("did not throw");
         }).catch((err) => {
           console.error(err.message);
           process.exitCode = 1;
         });`,
      ],
      {
        cwd: repoRoot,
        env: {
          ...process.env,
          NODE_ENV: "production",
          BETTER_AUTH_SECRET: "",
          DATABASE_URL: "postgresql://irrelevant/irrelevant",
        },
        timeout: 5000,
        encoding: "utf8",
      }
    );

    assert.notEqual(result.status, 0, "must exit non-zero rather than silently accept a forgeable dev secret");
    assert.match(result.stderr, /BETTER_AUTH_SECRET is not set in production/);
  });
});
