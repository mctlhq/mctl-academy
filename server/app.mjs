import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { authRouter } from "./routes/auth.mjs";
import { initDb } from "./db.mjs";

export const app = new Hono();

// Initialize DB schema asynchronously on start
initDb().catch((err) => console.error("[db] Init error:", err));

// Mount auth router
app.route("/api/auth", authRouter);

// In-memory fallback store for question reports
const reports = [];

const VALID_REASONS = new Set([
  "typo",
  "factual_error",
  "unclear_stem",
  "bad_distractor",
  "other"
]);

// Healthcheck endpoint
app.get("/healthz", (c) => {
  return c.json({ status: "ok", service: "mctl-academy", runtime: typeof Bun !== "undefined" ? "bun" : "node" });
});

// Question Report intake endpoint
app.post("/api/reports", async (c) => {
  try {
    const body = await c.req.json();
    const { question_id, reason, comment } = body || {};

    if (!question_id || typeof question_id !== "string") {
      return c.json({ error: "question_id is required" }, 400);
    }

    if (!reason || !VALID_REASONS.has(reason)) {
      return c.json({ error: "Invalid or missing reason" }, 400);
    }

    const report = {
      id: `rep-${randomUUID().slice(0, 8)}`,
      question_id,
      reason,
      comment: typeof comment === "string" ? comment.slice(0, 1000) : "",
      created_at: new Date().toISOString()
    };

    reports.push(report);

    return c.json({ success: true, report }, 201);
  } catch (err) {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }
});

// GET /api/reports for testing & verification
app.get("/api/reports", (c) => {
  return c.json({ reports, count: reports.length });
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
