import pg from "pg";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";
import { dbSslConfig } from "./db-ssl.mjs";

const { Pool, Client } = pg;
const migrationsDir = `${dirname(fileURLToPath(import.meta.url))}/../migrations`;

let pool = null;

// In-memory fallbacks when DATABASE_URL is not configured. User/session
// storage has no equivalent here since PR4 — better-auth (server/auth.mjs)
// owns that data now and requires a real Postgres unconditionally.
const memAttempts = []; // array of attempt objects
const memQuestionReports = []; // array of question report objects

/**
 * Initialize the database.
 *
 * DATABASE_URL is required unconditionally, in every environment — since
 * PR4, server/auth.mjs (better-auth) has no in-memory fallback the way this
 * module's own memAttempts/memQuestionReports arrays do, so there is no
 * environment left where the app can usefully run without a real Postgres.
 * A missing DATABASE_URL or a failed connection both throw here, and the
 * caller in app.mjs treats that as fatal — the process exits, and Kubernetes
 * restarts the pod according to its restart policy rather than serving from
 * a broken state.
 */
export async function initDb() {
  const dbUrl = process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === "production";

  if (!dbUrl) {
    throw new Error(
      "DATABASE_URL is not set" +
        (isProduction ? " in production" : "") +
        ". Refusing to start on an in-memory store, which silently loses all " +
        "sessions and attempts on restart, and which better-auth has no " +
        "equivalent of at all."
    );
  }

  // Shared with scripts/migrate.mjs via db-ssl.mjs — see that file for why:
  // this pool and the migration connection below disagreeing about SSL is
  // exactly the bug that module exists to make impossible.
  const sslConfig = dbSslConfig(isProduction);

  pool = new Pool({
    connectionString: dbUrl,
    ssl: sslConfig,
    connectionTimeoutMillis: 5000,
  });

  // pg.Pool emits 'error' when an already-idle client's connection drops
  // (a DB restart, a network blip). With no listener, Node treats that as an
  // unhandled exception and crashes the whole process — which would silently
  // defeat the point of /readyz: a database blip should fail readiness and
  // let the pod recover, not kill an otherwise-healthy pod outright.
  pool.on("error", (err) => {
    console.error("[db] Idle client error:", err.message);
  });

  const migrationClient = new Client({
    connectionString: dbUrl,
    ssl: sslConfig,
    connectionTimeoutMillis: 5000,
  });

  try {
    await migrationClient.connect();

    // Versioned, transactional migrations replace the old
    // CREATE TABLE IF NOT EXISTS block. node-pg-migrate takes a Postgres
    // advisory lock for the duration of the run, so when a rollout starts
    // several pods at once, only one applies pending migrations while the
    // rest wait for the lock and then find nothing left to do — "wait"
    // rather than the library's default "fail" is what makes that safe
    // instead of a crash-loop on "another migration is already running".
    await runner({
      dbClient: migrationClient,
      dir: migrationsDir,
      migrationsTable: "pgmigrations",
      direction: "up",
      singleTransaction: true,
      advisoryLockMode: "wait",
    });

    console.log("[db] Migrations applied successfully.");
    return true;
  } catch (err) {
    // pool connects lazily, so nothing has necessarily opened a socket yet —
    // but ending it explicitly is cheap, and means a future change that
    // touches pool before the migration completes can't leak a connection.
    await pool.end().catch(() => {});
    pool = null;
    if (isProduction) {
      throw new Error(`[db] Migration failed in production: ${err.message}`);
    }
    console.error("[db] Migration failed, falling back to memory store:", err.message);
    return false;
  } finally {
    await migrationClient.end().catch(() => {});
  }
}

/**
 * Used by GET /readyz. In production, pool is guaranteed set (initDb() throws
 * otherwise), so this exercises a real round trip to the database rather than
 * trusting that a successful connection at boot is still true minutes later.
 * Outside production, the in-memory store is always considered ready.
 */
export async function checkDbReady() {
  if (!pool) {
    return { ready: true, mode: "memory" };
  }
  await pool.query("SELECT 1");
  return { ready: true, mode: "postgres" };
}

export async function recordUserAttempt({ userId, questionId, domain, correct }) {
  if (pool) {
    const res = await pool.query(
      `INSERT INTO attempts (user_id, question_id, domain, correct)
       VALUES ($1, $2, $3, $4)
       RETURNING id, question_id, domain, correct, attempted_at;`,
      [userId || null, questionId, domain, correct]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      questionId: row.question_id,
      domain: row.domain,
      correct: row.correct,
      attemptedAt: row.attempted_at,
    };
  }

  const attempt = {
    id: randomUUID(),
    userId: userId || null,
    questionId,
    domain,
    correct,
    attemptedAt: new Date().toISOString(),
  };
  memAttempts.push(attempt);
  return attempt;
}

/**
 * Every attempt this learner has, latest per question.
 *
 * Not scoped by course, because an attempt has no course: which course a
 * question belongs to is content metadata the client already has, so it scopes
 * progress by intersecting these attempts with the active course's question
 * ids. Keeping the server out of that avoids storing content facts as personal
 * data and re-deriving them on every content change.
 */
export async function getUserAttempts(userId) {
  if (pool) {
    const res = await pool.query(
      `SELECT DISTINCT ON (question_id) question_id, domain, correct, attempted_at
       FROM attempts
       WHERE user_id = $1
       ORDER BY question_id, attempted_at DESC;`,
      [userId]
    );
    return res.rows.map((r) => ({
      questionId: r.question_id,
      domain: r.domain,
      correct: r.correct,
      attemptedAt: r.attempted_at,
    }));
  }

  const userAttempts = memAttempts.filter((a) => a.userId === userId);
  const map = new Map();
  for (const a of userAttempts) {
    map.set(a.questionId, a);
  }
  return [...map.values()];
}

export async function insertQuestionReport({ questionId, reason, comment, reporterUserId }) {
  if (pool) {
    const res = await pool.query(
      `INSERT INTO question_reports (question_id, reason, comment, reporter_user_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, question_id, reason, comment, reporter_user_id, created_at;`,
      [questionId, reason, comment || null, reporterUserId || null]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      questionId: row.question_id,
      reason: row.reason,
      comment: row.comment,
      reporterUserId: row.reporter_user_id,
      createdAt: row.created_at,
    };
  }

  const report = {
    id: randomUUID(),
    questionId,
    reason,
    comment: comment || null,
    reporterUserId: reporterUserId || null,
    createdAt: new Date().toISOString(),
  };
  memQuestionReports.push(report);
  return report;
}

export async function listRecentQuestionReports(limit = 50) {
  if (pool) {
    const res = await pool.query(
      `SELECT id, question_id, reason, comment, reporter_user_id, created_at
       FROM question_reports
       ORDER BY created_at DESC
       LIMIT $1;`,
      [limit]
    );
    return res.rows.map((row) => ({
      id: row.id,
      questionId: row.question_id,
      reason: row.reason,
      comment: row.comment,
      reporterUserId: row.reporter_user_id,
      createdAt: row.created_at,
    }));
  }

  return memQuestionReports.slice(-limit).reverse();

}
