import { Hono } from "hono";
import { auth } from "../auth.mjs";
import { recordUserAttempt, getUserAttempts } from "../db.mjs";
import { requireSameOrigin } from "../middleware/csrf.mjs";

export const attemptsRouter = new Hono();

/**
 * An attempt is stored against its questionId and nothing more.
 *
 * Course membership is deliberately not part of this payload or this table:
 * it is canonical content metadata (questionId -> question.course_id), so the
 * client derives per-course progress by intersecting attempts with the active
 * course's question ids. Storing it here would duplicate content as personal
 * learner data, and leave two records of the same fact to reconcile whenever
 * content moves.
 */
async function requireUser(c) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user ?? null;
}

function serializeAttempt(attempt) {
  return {
    questionId: attempt.questionId ?? attempt.question_id,
    domain: attempt.domain,
    correct: attempt.correct,
    attemptedAt: attempt.attemptedAt ?? attempt.attempted_at,
  };
}

// POST /api/attempts - Record a practice attempt for the signed-in learner
attemptsRouter.post("/", requireSameOrigin, async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  let body;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON payload" }, 400);
  }

  const { questionId, domain, correct } = body || {};

  if (!questionId || typeof questionId !== "string") {
    return c.json({ error: "questionId is required" }, 400);
  }
  if (!domain || typeof domain !== "string") {
    return c.json({ error: "domain is required" }, 400);
  }
  if (typeof correct !== "boolean") {
    return c.json({ error: "correct must be a boolean" }, 400);
  }

  const stored = await recordUserAttempt({ userId: user.id, questionId, domain, correct });

  return c.json({ success: true, attempt: serializeAttempt(stored) }, 201);
});

// GET /api/attempts - Latest attempt per question for the signed-in learner
attemptsRouter.get("/", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const attempts = await getUserAttempts(user.id);
  return c.json({ attempts: attempts.map(serializeAttempt) });
});
