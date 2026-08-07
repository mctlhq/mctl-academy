import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONTAINER = "mctl-academy-readyz-live-test";
const PG_PORT = 55432;
const APP_PORT = 55080;

function dockerAvailable() {
  try {
    execFileSync("docker", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, { timeoutMs = 20000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

async function httpGetJson(url) {
  const res = await fetch(url);
  return { status: res.status, body: await res.json() };
}

/**
 * checkDbReady()'s real-Postgres branch — pool set, a query actually run —
 * has no coverage anywhere else. tests/server.test.mjs only exercises the
 * memory-store path, and db-hard-fail.test.mjs only covers the "never
 * connected" case, not "was connected, backend went away". This spins up a
 * disposable Postgres, boots the real server as a live subprocess against
 * it, and kills the database out from under a running pod — the actual
 * scenario /readyz exists for.
 *
 * NODE_ENV is deliberately NOT production here: the local/CI Postgres has no
 * SSL listener, same as the plain postgres:17-alpine service container this
 * suite already uses in CI for migrations. The production-specific
 * hard-fail-at-boot behavior is covered separately in db-hard-fail.test.mjs;
 * this test is about checkDbReady()'s live-failure branch, not about SSL.
 */
describe("GET /readyz against a real, later-killed Postgres", { skip: !dockerAvailable() && "docker is not available" }, () => {
  test("reports ready while the database is up, and fails within seconds once it is gone — without crashing the process", async () => {
    try {
      execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    } catch {
      // no prior container — fine
    }

    execFileSync("docker", [
      "run", "-d", "--name", CONTAINER,
      "-e", "POSTGRES_PASSWORD=test",
      "-e", "POSTGRES_DB=readyz_live",
      "-p", `${PG_PORT}:5432`,
      "postgres:17-alpine",
    ]);

    let serverProcess;
    try {
      const pgReady = await waitFor(() => {
        try {
          execFileSync("docker", ["exec", CONTAINER, "psql", "-U", "postgres", "-d", "readyz_live", "-c", "select 1"], {
            stdio: "ignore",
          });
          return true;
        } catch {
          return false;
        }
      });
      assert.ok(pgReady, "Postgres never became ready");

      serverProcess = spawn(process.execPath, ["server/index.mjs"], {
        cwd: repoRoot,
        env: {
          ...process.env,
          DATABASE_URL: `postgresql://postgres:test@localhost:${PG_PORT}/readyz_live`,
          PORT: String(APP_PORT),
        },
      });

      const serverUp = await waitFor(async () => {
        try {
          const { status } = await httpGetJson(`http://localhost:${APP_PORT}/livez`);
          return status === 200;
        } catch {
          return false;
        }
      });
      assert.ok(serverUp, "server never came up");

      const readyBefore = await httpGetJson(`http://localhost:${APP_PORT}/readyz`);
      assert.equal(readyBefore.status, 200);
      assert.equal(readyBefore.body.db, "postgres");

      execFileSync("docker", ["stop", CONTAINER]);

      const readyAfter = await waitFor(async () => {
        const { status } = await httpGetJson(`http://localhost:${APP_PORT}/readyz`);
        return status === 503;
      });
      assert.ok(readyAfter, "/readyz never reported the database as unreachable");

      const finalCheck = await httpGetJson(`http://localhost:${APP_PORT}/readyz`);
      assert.equal(finalCheck.status, 503);
      assert.equal(finalCheck.body.error, "database unreachable");

      // The whole point of pool.on('error', ...): an idle-connection drop is
      // not an unhandled exception. If it were, the process would already be
      // dead and this would fail to connect at all.
      const stillAlive = await httpGetJson(`http://localhost:${APP_PORT}/livez`);
      assert.equal(stillAlive.status, 200, "the process must survive a database outage, not crash");
    } finally {
      serverProcess?.kill();
      execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
    }
  });
});
