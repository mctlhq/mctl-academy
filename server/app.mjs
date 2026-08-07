import { Hono } from "hono";
import { authRouter } from "./routes/auth.mjs";
import { initDb, insertQuestionReport, listRecentQuestionReports } from "./db.mjs";
import { isKnownQuestionId } from "./questions.mjs";
import { rateLimit } from "./middleware/rate-limit.mjs";

export const app = new Hono();

// Initialize DB schema asynchronously on start
initDb().catch((err) => console.error("[db] Init error:", err));

// Mount auth router
app.route("/api/auth", authRouter);

const VALID_REASONS = new Set([
  "typo",
  "factual_error",
  "unclear_stem",
  "bad_distractor",
  "other"
]);

const MAX_COMMENT_LENGTH = 2000;

// Healthcheck endpoint
app.get("/healthz", (c) => {
  return c.json({ status: "ok", service: "mctl-academy", runtime: typeof Bun !== "undefined" ? "bun" : "node" });
});

// Question Report intake endpoint (issue #22)
app.post("/api/reports", rateLimit(), async (c) => {
  try {
    const body = await c.req.json();
    const { question_id, reason, comment } = body || {};

    if (!question_id || typeof question_id !== "string") {
      return c.json({ error: "question_id is required" }, 400);
    }

    if (!reason || !VALID_REASONS.has(reason)) {
      return c.json({ error: "Invalid or missing reason" }, 400);
    }

    if (comment !== undefined && comment !== null) {
      if (typeof comment !== "string") {
        return c.json({ error: "comment must be a string" }, 400);
      }
      if (comment.length > MAX_COMMENT_LENGTH) {
        return c.json({ error: `comment must be ${MAX_COMMENT_LENGTH} characters or fewer` }, 400);
      }
    }

    if (!isKnownQuestionId(question_id)) {
      return c.json({ error: "Unknown question_id" }, 404);
    }

    const report = await insertQuestionReport({
      questionId: question_id,
      reason,
      comment: typeof comment === "string" ? comment : ""
    });

    return c.json(
      {
        success: true,
        report: {
          id: report.id,
          question_id: report.questionId,
          reason: report.reason,
          comment: report.comment,
          created_at: report.createdAt
        }
      },
      201
    );
  } catch (err) {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }
});

// GET /api/reports for testing & verification
app.get("/api/reports", async (c) => {
  const reports = await listRecentQuestionReports();
  return c.json({
    reports: reports.map((r) => ({
      id: r.id,
      question_id: r.questionId,
      reason: r.reason,
      comment: r.comment,
      created_at: r.createdAt
    })),
    count: reports.length
  });
});

// Serve static frontend assets from client/dist with SPA fallback
if (typeof Bun !== "undefined") {
  const { serveStatic } = await import("hono/bun");
  app.use("/*", serveStatic({ root: "./client/dist" }));
  app.get("/*", serveStatic({ path: "./client/dist/index.html" }));
} else {
  const { serveStatic } = await import("@hono/node-server/serve-static");
  app.use("/*", serveStatic({ root: "./client/dist" }));
  app.get("/*", serveStatic({ path: "./client/dist/index.html" }));
}
