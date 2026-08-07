import pg from "pg";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { runner } from "node-pg-migrate";

const { Pool, Client } = pg;
const migrationsDir = `${dirname(fileURLToPath(import.meta.url))}/../migrations`;

let pool = null;

// In-memory fallbacks when DATABASE_URL is not configured
const memUsers = new Map(); // id -> user
const memGithubUsers = new Map(); // github_id -> user
const memSessions = new Map(); // token -> { userId, expiresAt }
const memAttempts = []; // array of attempt objects
const memQuestionReports = []; // array of question report objects

/**
 * Initialize the database, or fall back to an in-memory store.
 *
 * The in-memory fallback exists for tests and local development only. In
 * production it must never be reached silently: a pod that "logs in"
 * successfully and then loses every session and attempt on its next restart
 * is worse than a pod that fails to start. So in production, both a missing
 * DATABASE_URL and a failed connection throw here, and the caller in app.mjs
 * treats that as fatal — the process exits, and Kubernetes restarts the pod
 * according to its restart policy rather than serving from memory.
 */
export async function initDb() {
  const dbUrl = process.env.DATABASE_URL;
  const isProduction = process.env.NODE_ENV === "production";

  if (!dbUrl) {
    if (isProduction) {
      throw new Error(
        "DATABASE_URL is not set in production. Refusing to start on the in-memory " +
          "fallback store, which silently loses all sessions and attempts on restart."
      );
    }
    console.log("[db] DATABASE_URL not set — using in-memory store.");
    return false;
  }

  // rejectUnauthorized: false matches the connection pattern already used by
  // mctl-loyalty and mctl-pairdesk against the same CNPG cluster; there is no
  // CA distribution in place yet to verify the server certificate. That gap is
  // a platform-wide concern, not something to solve differently in this one
  // service. Both connections below share this exact object so the migration
  // run and the long-lived query pool can never disagree about SSL — passing
  // `databaseUrl` straight to node-pg-migrate's runner() gave it no SSL
  // config at all, which only surfaced when tested against a real, non-SSL
  // local Postgres: the migration connected, then every later query on `pool`
  // failed, because `pool` alone was requesting SSL.
  const sslConfig = isProduction ? { rejectUnauthorized: false } : false;

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

  const migrationClient = new Client({ connectionString: dbUrl, ssl: sslConfig });

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

export async function upsertUser({ githubId, githubLogin, avatarUrl }) {
  if (pool) {
    const res = await pool.query(
      `INSERT INTO users (github_id, github_login, avatar_url, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (github_id) DO UPDATE
       SET github_login = EXCLUDED.github_login,
           avatar_url = EXCLUDED.avatar_url,
           updated_at = NOW()
       RETURNING id, github_id, github_login, avatar_url, created_at;`,
      [githubId, githubLogin, avatarUrl]
    );
    const row = res.rows[0];
    return {
      id: row.id,
      githubId: Number(row.github_id),
      githubLogin: row.github_login,
      avatarUrl: row.avatar_url,
      createdAt: row.created_at,
    };
  }

  let user = memGithubUsers.get(githubId);
  if (!user) {
    user = {
      id: randomUUID(),
      githubId,
      githubLogin,
      avatarUrl,
      createdAt: new Date().toISOString(),
    };
    memUsers.set(user.id, user);
    memGithubUsers.set(githubId, user);
  } else {
    user.githubLogin = githubLogin;
    user.avatarUrl = avatarUrl;
  }
  return user;
}

export async function createSession(userId, expiresInMs = 7 * 24 * 60 * 60 * 1000) {
  const token = `sess_${randomUUID().replace(/-/g, "")}`;
  const expiresAt = new Date(Date.now() + expiresInMs);

  if (pool) {
    await pool.query(
      `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3);`,
      [token, userId, expiresAt]
    );
  } else {
    memSessions.set(token, { userId, expiresAt });
  }

  return { token, expiresAt };
}

export async function getSessionUser(token) {
  if (!token) return null;

  if (pool) {
    const res = await pool.query(
      `SELECT u.id, u.github_id, u.github_login, u.avatar_url, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > NOW();`,
      [token]
    );
    if (res.rows.length === 0) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      githubId: Number(row.github_id),
      githubLogin: row.github_login,
      avatarUrl: row.avatar_url,
    };
  }

  const sess = memSessions.get(token);
  if (!sess) return null;
  if (new Date() > new Date(sess.expiresAt)) {
    memSessions.delete(token);
    return null;
  }
  return memUsers.get(sess.userId) || null;
}

export async function deleteSession(token) {
  if (!token) return;
  if (pool) {
    await pool.query(`DELETE FROM sessions WHERE id = $1;`, [token]);
  } else {
    memSessions.delete(token);
  }
}

export async function recordUserAttempt({ userId, questionId, domain, correct }) {
  if (pool) {
    const res = await pool.query(
      `INSERT INTO attempts (user_id, question_id, domain, correct)
       VALUES ($1, $2, $3, $4)
       RETURNING id, question_id, domain, correct, attempted_at;`,
      [userId || null, questionId, domain, correct]
    );
    return res.rows[0];
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
