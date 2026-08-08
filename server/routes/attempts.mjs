import { Hono } from "hono";
import { auth } from "../auth.mjs";
import { recordUserAttempt, getUserAttempts } from "../db.mjs";
import { requireSameOrigin } from "../middleware/csrf.mjs";

export const attemptsRouter = new Hono();

const COURSE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,62}$/;

async function requireUser(c) {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  return session?.user ?? null;
}

function serializeAttempt(attempt) {
  return {
    questionId: attempt.questionId ?? attempt.question_id,
    domain: attempt.domain,
    correct: attempt.correct,
    courseId: attempt.courseId ?? attempt.course_id ?? "agentic-ai-builder",
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

  const { questionId, domain, correct, courseId } = body || {};

  if (!questionId || typeof questionId !== "string") {
    return c.json({ error: "questionId is required" }, 400);
  }
  if (!domain || typeof domain !== "string") {
    return c.json({ error: "domain is required" }, 400);
  }
  if (typeof correct !== "boolean") {
    return c.json({ error: "correct must be a boolean" }, 400);
  }
  if (courseId !== undefined && (typeof courseId !== "string" || !COURSE_ID_PATTERN.test(courseId))) {
    return c.json({ error: "Invalid courseId format" }, 400);
  }

  const targetCourseId = courseId || "agentic-ai-builder";
  const stored = await recordUserAttempt({
    userId: user.id,
    questionId,
    domain,
    correct,
    courseId: targetCourseId,
  });

  return c.json({ success: true, attempt: serializeAttempt(stored) }, 201);
});

// GET /api/attempts - Latest attempt per question for the signed-in learner
attemptsRouter.get("/", async (c) => {
  const user = await requireUser(c);
  if (!user) {
    return c.json({ error: "Authentication required" }, 401);
  }

  const courseId = c.req.query("course_id") || "agentic-ai-builder";
  if (!COURSE_ID_PATTERN.test(courseId)) {
    return c.json({ error: "Invalid course_id format" }, 400);
  }

  const attempts = await getUserAttempts(user.id, courseId);
  return c.json({ attempts: attempts.map(serializeAttempt) });
});
