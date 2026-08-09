import { getItem, removeItem, resetStorage, setItem } from "./storage";

export interface QuestionAttempt {
  questionId: string;
  domain: string;
  correct: boolean;
  attemptedAt: string;
}

/**
 * Reduces a raw attempt log (possibly several attempts per question, in any
 * order) down to one row per question — the most recent by `attemptedAt`.
 * The log itself stays append-only (see recordAttempt); this is purely a
 * read-time view for progress/mistake computation, mirroring what the server
 * already does with `DISTINCT ON (question_id) ... ORDER BY attempted_at DESC`.
 */
function latestPerQuestion(attempts: QuestionAttempt[]): QuestionAttempt[] {
  const latest = new Map<string, QuestionAttempt>();
  for (const a of attempts) {
    const existing = latest.get(a.questionId);
    if (!existing || new Date(a.attemptedAt).getTime() >= new Date(existing.attemptedAt).getTime()) {
      latest.set(a.questionId, a);
    }
  }
  return [...latest.values()];
}

export interface DomainProgress {
  domainId: string;
  domainTitle: string;
  totalQuestions: number;
  attemptedQuestions: number;
  correctQuestions: number;
  accuracy: number; // percentage 0 - 100
}

export interface OverallProgress {
  totalBankQuestions: number;
  totalAttempted: number;
  totalCorrect: number;
  overallAccuracy: number; // percentage 0 - 100
  totalMistakes: number;
  domainProgress: DomainProgress[];
}

const STORAGE_KEY = "mctl_academy_progress_v1";
const ATTEMPTS_ENDPOINT = "/api/attempts";

let syncEnabled = false;

export function saveRawAttempts(attempts: QuestionAttempt[]): void {
  setItem(STORAGE_KEY, JSON.stringify(attempts));
}

/** Clears stored progress and any memory fallback. Tests own this. */
export function resetMemoryFallback(): void {
  resetStorage();
}

export function getStoredAttempts(): QuestionAttempt[] {
  try {
    const raw = getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as QuestionAttempt[];
  } catch {
    return [];
  }
}

/**
 * Counts consecutive calendar days with at least one recorded attempt,
 * ending today (or yesterday so a learner does not lose the streak before
 * their first session of the day). Attempts are already stored in ISO UTC;
 * reducing them to YYYY-MM-DD keeps the result stable across reloads.
 */
export function calculateStudyStreak(
  attempts: QuestionAttempt[] = getStoredAttempts(),
  now: Date = new Date(),
): number {
  if (attempts.length === 0) return 0;

  const activeDays = new Set(attempts.map((attempt) => attempt.attemptedAt.slice(0, 10)));
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const today = cursor.toISOString().slice(0, 10);

  if (!activeDays.has(today)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    if (!activeDays.has(cursor.toISOString().slice(0, 10))) return 0;
  }

  let streak = 0;
  while (activeDays.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

/**
 * Enables or disables best-effort server sync for signed-in learners. Off by
 * default: with sync disabled, recordAttempt and syncFromServer behave
 * exactly as they did before this module knew about a server, making no
 * network calls at all.
 */
export function setSyncEnabled(enabled: boolean): void {
  syncEnabled = enabled;
}

/**
 * The complete set of fields a learner attempt ever transmits. Course
 * membership is deliberately absent: it is canonical content metadata
 * (questionId -> question.course_id), so sending it would duplicate content as
 * personal learner data and create a reconciliation problem the server does
 * not need to have.
 */
function postAttemptToServer(questionId: string, domain: string, correct: boolean): void {
  fetch(ATTEMPTS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ questionId, domain, correct }),
  }).catch(() => {
    // Best-effort only: the local write already succeeded, so a sync
    // failure (offline, expired session, 5xx) is never surfaced.
  });
}

/**
 * Appends a new attempt to the local log. The log is append-only — a retry
 * of a question already attempted (e.g. once in Practice, later in a Mock
 * exam) adds a new row rather than overwriting the earlier one, matching the
 * server's own immutable `attempts` table. Callers that need "the learner's
 * current state per question" (progress stats, mistakes) derive it via
 * latestPerQuestion rather than relying on storage holding one row per
 * question.
 */
export function recordAttempt(questionId: string, domain: string, correct: boolean): void {
  try {
    const attempts = getStoredAttempts();
    attempts.push({
      questionId,
      domain,
      correct,
      attemptedAt: new Date().toISOString(),
    });
    setItem(STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    // Ignore storage errors
  }

  if (syncEnabled) {
    postAttemptToServer(questionId, domain, correct);
  }
}

/**
 * Pulls the signed-in learner's server-recorded attempts (a single
 * GET /api/attempts call, latest per question) and reconciles them with the
 * local log. The server's own `attempts` table is append-only and
 * server-timestamped; this function does not delete or overwrite anything on
 * either side — it only adds rows neither side already has:
 *
 * - A server record is appended locally only if it is strictly newer than
 *   this device's own latest local attempt for that question (i.e. it came
 *   from a different device/session this log has never seen).
 * - A local attempt is backfilled to the server (individual POST
 *   /api/attempts calls) whenever the server's latest record for that
 *   question is missing or older than it — not merely when the server has
 *   no record at all — so an update made offline after an earlier sync is
 *   never stranded on this device.
 *
 * A no-op while sync is disabled, and any network failure leaves local data
 * untouched.
 */
export async function syncFromServer(): Promise<void> {
  if (!syncEnabled) return;

  let serverAttempts: QuestionAttempt[];
  try {
    const res = await fetch(ATTEMPTS_ENDPOINT, { credentials: "same-origin" });
    if (!res.ok) return;
    const data = await res.json();
    serverAttempts = Array.isArray(data?.attempts) ? data.attempts : [];
  } catch {
    return;
  }

  const local = getStoredAttempts();
  const localLatestByQuestion = new Map(latestPerQuestion(local).map((a) => [a.questionId, a]));

  const newFromServer = serverAttempts.filter((a) => {
    const existing = localLatestByQuestion.get(a.questionId);
    return !existing || new Date(a.attemptedAt).getTime() > new Date(existing.attemptedAt).getTime();
  });

  if (newFromServer.length > 0) {
    try {
      setItem(STORAGE_KEY, JSON.stringify([...local, ...newFromServer]));
    } catch {
      // Ignore storage errors; fall through so backfill still gets attempted.
    }
  }

  const serverLatestByQuestion = new Map(serverAttempts.map((a) => [a.questionId, a]));
  for (const a of localLatestByQuestion.values()) {
    const serverRecord = serverLatestByQuestion.get(a.questionId);
    const serverIsUpToDate =
      serverRecord && new Date(serverRecord.attemptedAt).getTime() >= new Date(a.attemptedAt).getTime();
    if (!serverIsUpToDate) {
      postAttemptToServer(a.questionId, a.domain, a.correct);
    }
  }
}

export function getMistakeQuestionIds(): string[] {
  const attempts = latestPerQuestion(getStoredAttempts());
  return attempts.filter((a) => !a.correct).map((a) => a.questionId);
}

export function clearProgress(): void {
  try {
    removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

/**
 * Statistics for one course.
 *
 * `bundle` is the scope, and the only scope: callers pass the active course's
 * questions, and every number below is derived by intersecting stored attempts
 * with those question ids. Attempts from another course simply do not match
 * any id, so a course's progress is isolated without the attempt records
 * knowing anything about courses.
 *
 * `domainTitles` comes from the generated course catalog rather than a
 * hardcoded map, so a course whose domains differ still reads correctly.
 */
export function calculateProgressStats(
  bundle: Array<{ id: string; domain: string }>,
  attempts: QuestionAttempt[] = getStoredAttempts(),
  domainTitles: Record<string, string> = {},
): OverallProgress {
  const attemptsMap = new Map<string, QuestionAttempt>();
  for (const a of latestPerQuestion(attempts)) {
    attemptsMap.set(a.questionId, a);
  }

  const domainGroups = new Map<string, { total: number; attempted: number; correct: number }>();

  for (const q of bundle) {
    if (!domainGroups.has(q.domain)) {
      domainGroups.set(q.domain, { total: 0, attempted: 0, correct: 0 });
    }
    const group = domainGroups.get(q.domain)!;
    group.total += 1;

    const attempt = attemptsMap.get(q.id);
    if (attempt) {
      group.attempted += 1;
      if (attempt.correct) {
        group.correct += 1;
      }
    }
  }

  let totalAttempted = 0;
  let totalCorrect = 0;
  let totalMistakes = 0;

  const domainProgress: DomainProgress[] = [];

  for (const [domainId, stats] of domainGroups.entries()) {
    totalAttempted += stats.attempted;
    totalCorrect += stats.correct;

    const accuracy = stats.attempted > 0 ? Math.round((stats.correct / stats.attempted) * 100) : 0;

    domainProgress.push({
      domainId,
      domainTitle: domainTitles[domainId] || domainId,
      totalQuestions: stats.total,
      attemptedQuestions: stats.attempted,
      correctQuestions: stats.correct,
      accuracy,
    });
  }

  // Mistakes are counted inside the scope too — an open mistake in another
  // course is not this course's business.
  for (const q of bundle) {
    const attempt = attemptsMap.get(q.id);
    if (attempt && !attempt.correct) {
      totalMistakes += 1;
    }
  }

  const overallAccuracy = totalAttempted > 0 ? Math.round((totalCorrect / totalAttempted) * 100) : 0;

  return {
    totalBankQuestions: bundle.length,
    totalAttempted,
    totalCorrect,
    overallAccuracy,
    totalMistakes,
    domainProgress: domainProgress.sort((a, b) => a.domainId.localeCompare(b.domainId)),
  };
}
