import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { auth, assertAuthSecretConfigured } from "./auth.mjs";
import { attemptsRouter } from "./routes/attempts.mjs";
import { accountRouter } from "./routes/account.mjs";
import { initDb, checkDbReady, insertQuestionReport, listRecentQuestionReports } from "./db.mjs";
import { isKnownQuestionId } from "./questions.mjs";
import { rateLimit } from "./middleware/rate-limit.mjs";
import {
  securityHeaders,
  applySecurityHeaders,
  applySecurityHeadersToResponse
} from "./middleware/security-headers.mjs";

export const app = new Hono();

// Applied first so it wraps every response below, including the static
// SPA fallback — a security header baseline is not just an API concern.
app.use("*", securityHeaders);

/**
 * A handler throwing unwinds past securityHeaders' post-next() code (that's
 * how middleware works — a rejected next() skips straight to the nearest
 * catch), so Hono's default 500 would otherwise ship with no security
 * headers at all. This is the only other place a response leaves the app.
 *
 * Exported (rather than inlined into app.onError below) so
 * tests/security-headers.test.mjs can register this exact function on a
 * throwaway probe app instead of a hand-duplicated copy — a change here that
 * drops applySecurityHeaders() breaks that test too, not just this file.
 *
 * HTTPException is handled first and returned via its own getResponse():
 * it's Hono's mechanism for *intentional* HTTP responses raised as
 * exceptions (auth/validation libraries use it), and none of this app's own
 * code throws it today — but folding it into the generic 500 branch would
 * turn a deliberate 401/429/etc. into a wrong, generic 500 the moment
 * something in the dependency chain starts using it.
 */
export function errorHandler(err, c) {
  if (err instanceof HTTPException) {
    // getResponse() builds its own Response, never assigned to c.res, so
    // c.header() has nothing to attach to here — headers go on that
    // Response object directly. See applySecurityHeadersToResponse's doc
    // comment for why mutating it is safe.
    return applySecurityHeadersToResponse(err.getResponse());
  }
  console.error("[onError] Unhandled:", err.message);
  c.status(500);
  applySecurityHeaders(c);
  return c.json({ error: "Internal server error" });
}
app.onError(errorHandler);

// Both fatal-on-failure by design, in production: a missing DATABASE_URL or
// BETTER_AUTH_SECRET must stop the pod from ever serving traffic rather than
// silently run with a broken data layer or a forgeable session secret. The
// process exits and lets Kubernetes restart it according to its restart
// policy. See the comments on initDb() in db.mjs and
// assertAuthSecretConfigured() in auth.mjs.
try {
  await initDb();
  assertAuthSecretConfigured();
} catch (err) {
  console.error("[boot] Fatal:", err.message);
  process.exit(1);
}

// better-auth owns /api/auth/* wholesale — origin validation, CSRF/Fetch
// Metadata checks and secure production cookies are its concern, not a
// parallel hand-rolled middleware. See server/auth.mjs.
app.on(["POST", "GET"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Mount attempt sync router (issue #57)
app.route("/api/attempts", attemptsRouter);

// Self-service account deletion (Art 17 erasure) — not better-auth's own
// deleteUser, which requires email verification even for OAuth-only users.
// See server/routes/account.mjs.
app.route("/api/account", accountRouter);

const VALID_REASONS = new Set([
  "typo",
  "factual_error",
  "unclear_stem",
  "bad_distractor",
  "other"
]);

const MAX_COMMENT_LENGTH = 2000;

/**
 * /healthz and /livez both answer "is the process alive", with no dependency
 * checks — a Postgres blip must never fail liveness, or Kubernetes will
 * restart an application pod that has nothing wrong with it. /healthz is kept
 * as an alias: it is the chart's configured liveness path today.
 */
function livenessHandler(c) {
  return c.json({ status: "ok", service: "mctl-academy", runtime: typeof Bun !== "undefined" ? "bun" : "node" });
}
app.get("/healthz", livenessHandler);
app.get("/livez", livenessHandler);

/**
 * /readyz answers "can this pod serve traffic" — it is the only probe allowed
 * to depend on the database. In production checkDbReady() always has a real
 * pool to query (initDb() throws at boot otherwise), so this is a genuine
 * round trip, not a cached assumption that the connection made at startup is
 * still good.
 */
app.get("/readyz", async (c) => {
  try {
    const { mode } = await checkDbReady();
    return c.json({ status: "ok", service: "mctl-academy", db: mode });
  } catch (err) {
    // Logged, not just returned: a readiness flap in production needs a
    // server-side trail to correlate against, since the 503 response body
    // alone doesn't say whether it was a timeout, an auth failure, or
    // something else.
    console.error("[readyz] Database check failed:", err.message);
    return c.json({ status: "error", service: "mctl-academy", error: "database unreachable" }, 503);
  }
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

/**
 * GET /api/reports - moderator-only.
 *
 * Reports carry learner-authored free text and a reporter user id, so this
 * listing is personal data and must never be world-readable. Access requires a
 * valid session whose GitHub login is in MCTL_ACADEMY_MODERATORS (a
 * comma-separated allowlist). With the allowlist unset the route is closed to
 * everyone, so an unconfigured environment fails shut rather than open.
 */
app.get("/api/reports", async (c) => {
  const moderators = (process.env.MCTL_ACADEMY_MODERATORS || "")
    .split(",")
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean);

  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  const githubLogin = session?.user?.githubLogin;
  if (!githubLogin || !moderators.includes(String(githubLogin).toLowerCase())) {
    return c.json({ error: "Not found" }, 404);
  }

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
