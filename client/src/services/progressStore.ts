import { getItem, removeItem, resetStorage, setItem } from "./storage";

export interface QuestionAttempt {
  questionId: string;
  domain: string;
  correct: boolean;
  attemptedAt: string;
  /**
   * Set once this exact row has been confirmed synced to the server —
   * either this device POSTed it successfully, or a sync already found the
   * server's own record at least as recent. Deliberately NOT re-derived from
   * a timestamp comparison on every syncFromServer call: this device's clock
   * may be skewed relative to the server's, and a skewed clock that never
   * "catches up" would otherwise make the same row look stale forever,
   * reposting it indefinitely. Once true, a row is settled for good.
   */
  synced?: boolean;
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

/**
 * Bumped once per clearProgress() call, never compared to a timestamp.
 * syncFromServer() snapshots this before its GET and re-checks it after —
 * a mismatch means a clear started (and possibly already finished) while
 * that GET was in flight, so the response reflects pre-clear state and must
 * be discarded wholesale rather than merged. Purely an in-memory counter:
 * no clock is involved, so client/server clock skew can never affect it.
 */
let clearGeneration = 0;

/**
 * Set for the duration of a clearProgress() server round-trip (null the rest
 * of the time). syncFromServer() checks this before starting a GET at all,
 * so a sync does not even attempt to run concurrently with a clear — it is
 * not just a stale-response filter, it also avoids doing pointless network
 * work whose result would be thrown away.
 */
let clearInFlight: Promise<void> | null = null;

/**
 * Every in-flight POST /api/attempts (from recordAttempt's fire-and-forget
 * sync, or syncFromServer's backfill) is tracked here while it is pending.
 * clearProgress() awaits all of them before issuing its own DELETE, so a
 * write that started before Clear cannot land on the server after the
 * DELETE and silently resurrect an attempt the learner just erased.
 */
const pendingWrites = new Set<Promise<unknown>>();

function trackWrite<T>(promise: Promise<T>): Promise<T> {
  pendingWrites.add(promise);
  const untrack = () => pendingWrites.delete(promise);
  promise.then(untrack, untrack);
  return promise;
}

export function saveRawAttempts(attempts: QuestionAttempt[]): void {
  setItem(STORAGE_KEY, JSON.stringify(attempts));
}

/** Clears stored progress, any memory fallback, and in-memory state. Tests own this. */
export function resetMemoryFallback(): void {
  resetStorage();
  clearGeneration = 0;
  clearInFlight = null;
  pendingWrites.clear();
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
function postAttemptToServer(questionId: string, domain: string, correct: boolean): Promise<boolean> {
  return fetch(ATTEMPTS_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ questionId, domain, correct }),
  })
    .then((res) => res.ok)
    .catch(() => {
      // Best-effort only: the local write already succeeded, so a sync
      // failure (offline, expired session, 5xx) is never surfaced.
      return false;
    });
}

/** Flips one stored row to synced once the server has confirmed it, so it is never reconsidered. */
function markAttemptSynced(questionId: string, attemptedAt: string): void {
  try {
    const attempts = getStoredAttempts();
    const row = attempts.find((a) => a.questionId === questionId && a.attemptedAt === attemptedAt);
    if (row && !row.synced) {
      row.synced = true;
      setItem(STORAGE_KEY, JSON.stringify(attempts));
    }
  } catch {
    // Ignore storage errors
  }
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
  const attemptedAt = new Date().toISOString();
  try {
    const attempts = getStoredAttempts();
    attempts.push({ questionId, domain, correct, attemptedAt });
    setItem(STORAGE_KEY, JSON.stringify(attempts));
  } catch {
    // Ignore storage errors
  }

  if (syncEnabled) {
    trackWrite(postAttemptToServer(questionId, domain, correct)).then((ok) => {
      if (ok) markAttemptSynced(questionId, attemptedAt);
    });
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
 * - A local attempt not yet marked `synced` is backfilled to the server
 *   (individual POST /api/attempts calls) unless the server's latest record
 *   for that question is already at least as recent — not merely "the
 *   server has some record" — so an update made offline after an earlier
 *   sync is never stranded on this device. Once a row is confirmed synced
 *   (by either path), it is flagged and never re-evaluated by timestamp
 *   again, so a skewed local clock cannot make the same row look stale
 *   forever and get reposted on every sync.
 *
 * A no-op while sync is disabled, and any network failure leaves local data
 * untouched.
 *
 * A clearProgress() call in flight is never raced: this bails out before
 * starting the GET at all if a clear is already running, and discards the
 * response wholesale if a clear started while the GET was in flight (see
 * `clearGeneration`) — either way, pre-clear data never gets merged back in.
 */
export async function syncFromServer(): Promise<void> {
  if (!syncEnabled) return;
  if (clearInFlight) return;

  const startGeneration = clearGeneration;

  let serverAttempts: QuestionAttempt[];
  try {
    const res = await fetch(ATTEMPTS_ENDPOINT, { credentials: "same-origin" });
    if (!res.ok) return;
    const data = await res.json();
    serverAttempts = Array.isArray(data?.attempts) ? data.attempts : [];
  } catch {
    return;
  }

  if (clearGeneration !== startGeneration) return;

  const local = getStoredAttempts();
  const localLatestByQuestion = new Map(latestPerQuestion(local).map((a) => [a.questionId, a]));

  const newFromServer = serverAttempts.filter((a) => {
    const existing = localLatestByQuestion.get(a.questionId);
    return !existing || new Date(a.attemptedAt).getTime() > new Date(existing.attemptedAt).getTime();
  });

  if (newFromServer.length > 0) {
    try {
      const withServerRows = [...local, ...newFromServer.map((a) => ({ ...a, synced: true }))];
      setItem(STORAGE_KEY, JSON.stringify(withServerRows));
    } catch {
      // Ignore storage errors; fall through so backfill still gets attempted.
    }
  }

  const serverLatestByQuestion = new Map(serverAttempts.map((a) => [a.questionId, a]));
  for (const a of localLatestByQuestion.values()) {
    if (a.synced) continue;

    const serverRecord = serverLatestByQuestion.get(a.questionId);
    const serverIsUpToDate =
      serverRecord && new Date(serverRecord.attemptedAt).getTime() >= new Date(a.attemptedAt).getTime();
    if (serverIsUpToDate) {
      markAttemptSynced(a.questionId, a.attemptedAt);
      continue;
    }

    trackWrite(postAttemptToServer(a.questionId, a.domain, a.correct)).then((ok) => {
      if (ok) markAttemptSynced(a.questionId, a.attemptedAt);
    });
  }
}

export function getMistakeQuestionIds(): string[] {
  const attempts = latestPerQuestion(getStoredAttempts());
  return attempts.filter((a) => !a.correct).map((a) => a.questionId);
}

/**
 * Clears local progress unconditionally, and — for a signed-in learner —
 * also deletes the server's copy via DELETE /api/attempts. Without the
 * server call, "Clear history" only ever looked permanent: the very next
 * syncFromServer() (next app load, or the periodic background sync) would
 * pull the untouched server rows straight back into local storage. Returns
 * whether the server side is actually known to be clear, so a caller can
 * tell the learner the truth when the network call fails rather than
 * claiming a deletion that did not happen.
 *
 * Before issuing the DELETE, this waits for every attempt POST already in
 * flight (see `pendingWrites`) — otherwise a write that started just before
 * Clear could complete just after the DELETE and recreate the very row the
 * learner asked to erase. `clearInFlight` is set for the whole round-trip so
 * syncFromServer() does not race a concurrent GET against it either.
 */
export async function clearProgress(): Promise<{ serverCleared: boolean }> {
  clearGeneration += 1;
  try {
    removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }

  if (!syncEnabled) {
    return { serverCleared: true };
  }

  let markDone!: () => void;
  clearInFlight = new Promise<void>((resolve) => {
    markDone = resolve;
  });

  try {
    if (pendingWrites.size > 0) {
      await Promise.allSettled([...pendingWrites]);
    }
    const res = await fetch(ATTEMPTS_ENDPOINT, { method: "DELETE", credentials: "same-origin" });
    return { serverCleared: res.ok };
  } catch {
    return { serverCleared: false };
  } finally {
    markDone();
    clearInFlight = null;
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
