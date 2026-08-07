import pg from "pg";
import { randomUUID } from "node:crypto";

const { Pool } = pg;

let pool = null;

// In-memory fallbacks when DATABASE_URL is not configured
const memUsers = new Map(); // id -> user
const memGithubUsers = new Map(); // github_id -> user
const memSessions = new Map(); // token -> { userId, expiresAt }
const memAttempts = []; // array of attempt objects
const memQuestionReports = []; // array of question report objects

export async function initDb() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.log("[db] DATABASE_URL not set — using in-memory store.");
    return false;
  }

  try {
    pool = new Pool({
      connectionString: dbUrl,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        github_id BIGINT UNIQUE NOT NULL,
        github_login VARCHAR(255) NOT NULL,
        avatar_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        question_id VARCHAR(255) NOT NULL,
        domain VARCHAR(255) NOT NULL,
        correct BOOLEAN NOT NULL,
        attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS question_reports (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        question_id VARCHAR(255) NOT NULL,
        reason VARCHAR(64) NOT NULL,
        comment TEXT,
        reporter_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS question_reports_question_id_idx
        ON question_reports (question_id);
    `);

    console.log("[db] PostgreSQL schema initialized successfully.");
    return true;
  } catch (err) {
    console.error("[db] PostgreSQL connection failed, falling back to memory store:", err.message);
    pool = null;
    return false;
  }
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
