import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const CONTAINER = "mctl-academy-readyz-live-test";
// Both ports are picked free at run time; a fixed one collided with a port
// already in use on the CI runner ("address already in use") and failed
// unrelated PRs.
let APP_PORT;
let PG_PORT;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

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
describe(
  "GET /readyz against a real, later-killed Postgres",
  { skip: !dockerAvailable() && "docker is not available" },
  () => {
    test("reports ready while the database is up, and fails within seconds once it is gone — without crashing the process", async () => {
      try {
        execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
      } catch {
        // no prior container — fine
      }

      execFileSync("docker", [
        "run",
        "-d",
        "--name",
        CONTAINER,
        "-e",
        "POSTGRES_PASSWORD=test",
        "-e",
        "POSTGRES_DB=readyz_live",
        "-p",
        "127.0.0.1::5432",
        "postgres:17-alpine",
      ]);
      // `docker port` can answer empty right after `docker run -d`, before
      // the binding is published. An empty PG_PORT made DATABASE_URL fall
      // back to localhost:5432 — nothing on a laptop (memory-store fallback),
      // and on CI the job's shared service Postgres, where this boot could
      // wait on another suite's migration lock until "server never came up".
      const portPublished = await waitFor(() => {
        try {
          PG_PORT = execFileSync("docker", ["port", CONTAINER, "5432/tcp"], { encoding: "utf8" })
            .trim()
            .split("\n")[0]
            .split(":")
            .pop();
        } catch {
          PG_PORT = "";
        }
        return /^\d+$/.test(PG_PORT);
      });
      assert.ok(portPublished, `docker never published a host port for ${CONTAINER}`);

      let serverProcess;
      try {
        // Over TCP (-h 127.0.0.1), not the default Unix socket: the image's
        // entrypoint first runs a temporary socket-only server for initdb,
        // then restarts. A socket check can pass against that temporary
        // server, and the app's TCP connection then lands in the restart.
        const pgReady = await waitFor(() => {
          try {
            execFileSync(
              "docker",
              [
                "exec",
                CONTAINER,
                "psql",
                "-h",
                "127.0.0.1",
                "-U",
                "postgres",
                "-d",
                "readyz_live",
                "-c",
                "select 1",
              ],
              {
                stdio: "ignore",
              },
            );
            return true;
          } catch {
            return false;
          }
        });
        assert.ok(pgReady, "Postgres never became ready");

        // In production this role is provisioned by CNPG's managed.roles, not
        // by this app (1755100000000_academy_readonly_role's migration only
        // grants; it can't create the role — see that file). This container
        // is a from-scratch Postgres of its own, so mirror that external
        // provisioning step here or the migration below fails with "role
        // academy_readonly does not exist" and — since NODE_ENV isn't
        // production in this test — initDb() silently falls back to the
        // in-memory store instead of throwing, which is exactly the kind of
        // masked failure this test exists to catch in the first place.
        execFileSync("docker", [
          "exec",
          CONTAINER,
          "psql",
          "-h",
          "127.0.0.1",
          "-U",
          "postgres",
          "-d",
          "readyz_live",
          "-c",
          "CREATE ROLE academy_readonly LOGIN;",
        ]);

        APP_PORT = await freePort();
        serverProcess = spawn(process.execPath, ["server/index.mjs"], {
          cwd: repoRoot,
          env: {
            ...process.env,
            DATABASE_URL: `postgresql://postgres:test@127.0.0.1:${PG_PORT}/readyz_live`,
            PORT: String(APP_PORT),
          },
        });
        // Kept for the failure message: without it a boot that never
        // answered left no trace of why.
        let serverOutput = "";
        serverProcess.stdout.on("data", (chunk) => (serverOutput += chunk));
        serverProcess.stderr.on("data", (chunk) => (serverOutput += chunk));
        let exitCode = null;
        serverProcess.once("exit", (code, signal) => (exitCode = code ?? signal));

        const serverUp = await waitFor(
          async () => {
            if (exitCode !== null) return true; // stop waiting; asserted below
            try {
              const { status } = await httpGetJson(`http://127.0.0.1:${APP_PORT}/livez`);
              return status === 200;
            } catch {
              return false;
            }
          },
          { timeoutMs: 45000 },
        );
        assert.equal(exitCode, null, `server exited (${exitCode}) during boot:\n${serverOutput}`);
        assert.ok(serverUp, `server never came up on port ${APP_PORT}:\n${serverOutput}`);

        const readyBefore = await httpGetJson(`http://127.0.0.1:${APP_PORT}/readyz`);
        assert.equal(readyBefore.status, 200);
        assert.equal(readyBefore.body.db, "postgres", `server did not use Postgres:\n${serverOutput}`);

        execFileSync("docker", ["stop", CONTAINER]);

        const readyAfter = await waitFor(async () => {
          const { status } = await httpGetJson(`http://127.0.0.1:${APP_PORT}/readyz`);
          return status === 503;
        });
        assert.ok(readyAfter, "/readyz never reported the database as unreachable");

        const finalCheck = await httpGetJson(`http://127.0.0.1:${APP_PORT}/readyz`);
        assert.equal(finalCheck.status, 503);
        assert.equal(finalCheck.body.error, "database unreachable");

        // The whole point of pool.on('error', ...): an idle-connection drop is
        // not an unhandled exception. If it were, the process would already be
        // dead and this would fail to connect at all.
        const stillAlive = await httpGetJson(`http://127.0.0.1:${APP_PORT}/livez`);
        assert.equal(stillAlive.status, 200, "the process must survive a database outage, not crash");
      } finally {
        serverProcess?.kill();
        execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
      }
    });
  },
);
