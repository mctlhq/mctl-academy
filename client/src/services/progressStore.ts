import { ref } from "vue";
import { getItem, removeItem, resetStorage, setItem } from "./storage";

/** Shared invalidation for every learning surface, including the navigation badge. */
export const progressVersion = ref(0);
export const progressEpoch = ref(getItem("academy.progress.epoch") ?? "0");

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
export function latestPerQuestion(attempts: QuestionAttempt[]): QuestionAttempt[] {
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
  solvedPercent: number;
  unseenQuestions: number;
}

export interface OverallProgress {
  totalBankQuestions: number;
  totalAttempted: number;
  totalCorrect: number;
  overallAccuracy: number; // percentage 0 - 100
  totalMistakes: number;
  totalUnseen: number;
  solvedPercent: number;
  domainProgress: DomainProgress[];
}

/**
 * The attempt log is kept per owner: one log for the guest and one per
 * signed-in account, under `<base>:guest` and `<base>:user:<id>`. A single
 * log per browser showed one account's answers to the guest after sign-out
 * and to the next account, and backfilled the first account's unsynced
 * answers into the second account's server history (#403).
 */
const LEGACY_STORAGE_KEY = "mctl_academy_progress_v1";
const GUEST_OWNER = "guest";
let progressOwner = GUEST_OWNER;

function logKey(owner: string = progressOwner): string {
  return `${LEGACY_STORAGE_KEY}:${owner}`;
}

function readLog(key: string): QuestionAttempt[] {
  try {
    const raw = getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as QuestionAttempt[]) : [];
  } catch {
    return [];
  }
}
const ATTEMPTS_ENDPOINT = "/api/attempts";

let syncEnabled = false;

/**
 * What the learner can truthfully be told about server sync. "synced" is
 * only ever set by a syncFromServer() that read the server AND had every
 * backfill write confirmed; a failed attempt POST afterwards downgrades it to
 * "failed" (the row stays unsynced until the next successful sync). "off"
 * means sync is disabled: progress lives on this device only.
 */
export type SyncStatus = "off" | "syncing" | "synced" | "failed";
export const syncStatus = ref<SyncStatus>("off");

/** Outcome of one syncFromServer() call. "deferred": a clear was in flight, nothing was learned. */
export type SyncOutcome = "disabled" | "deferred" | "failed" | "synced";

/**
 * Bumped on every setSyncEnabled() call, i.e. every sign-in, sign-out or
 * account change. Status updates carry the epoch they started under and are
 * dropped if it has moved on, so a slow request made for account A can never
 * paint "synced" (or "failed") onto account B's session.
 */
let syncEpoch = 0;

function setSyncStatusFor(epoch: number, status: SyncStatus): void {
  if (epoch === syncEpoch) syncStatus.value = status;
}

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

/**
 * Attempt POSTs for answers recorded while a clear's DELETE is unresolved.
 * They are held back until that DELETE has resolved and only then sent: a
 * POST issued alongside the DELETE could reach the server first and be
 * erased by it, while this device marks the row synced and never re-sends
 * it (#397). Each entry carries the sync epoch it was recorded under, so an
 * answer from account A is never sent on account B's session.
 */
let queuedWrites: Array<{ epoch: number; send: () => void }> = [];

/** The clear whose DELETE is still unresolved, holding new writes back (null otherwise). */
let writesHeldBy: Promise<void> | null = null;

/** Sends the writes held back by `clear`, unless a later overlapping clear has taken over. */
function releaseQueuedWrites(clear: Promise<void>): void {
  if (writesHeldBy !== clear) return;
  writesHeldBy = null;
  const queued = queuedWrites;
  queuedWrites = [];
  for (const write of queued) {
    if (syncEnabled && write.epoch === syncEpoch) write.send();
  }
}

function trackWrite<T>(promise: Promise<T>): Promise<T> {
  pendingWrites.add(promise);
  const untrack = () => pendingWrites.delete(promise);
  promise.then(untrack, untrack);
  return promise;
}

export function saveRawAttempts(attempts: QuestionAttempt[]): void {
  setItem(logKey(), JSON.stringify(attempts));
  progressVersion.value += 1;
}

/** Clears stored progress, any memory fallback, and in-memory state. Tests own this. */
export function resetMemoryFallback(): void {
  resetStorage();
  clearGeneration = 0;
  clearInFlight = null;
  pendingWrites.clear();
  queuedWrites = [];
  writesHeldBy = null;
  progressOwner = GUEST_OWNER;
  syncEpoch += 1;
  syncStatus.value = "off";
  progressVersion.value += 1;
  progressEpoch.value = "0";
}

export function getStoredAttempts(): QuestionAttempt[] {
  void progressVersion.value;
  return readLog(logKey());
}

/** The owner segment of every learner-scoped storage key: "guest" or "user:<id>". */
export function getProgressOwner(): string {
  return progressOwner;
}

/**
 * The single pre-#403 log has no known owner. Rows a server already holds
 * (`synced`) are dropped: the account they belong to pulls them back on its
 * next sign-in, and keeping them would show them to whoever is here now.
 * Rows never synced exist nowhere else, so they become guest rows and are
 * adopted by the next sign-in, like any other guest answer.
 */
function migrateLegacyLog(): void {
  const raw = getItem(LEGACY_STORAGE_KEY);
  if (raw === null) return;
  const unsynced = readLog(LEGACY_STORAGE_KEY).filter((a) => !a.synced);
  if (unsynced.length > 0) {
    setItem(logKey(GUEST_OWNER), JSON.stringify([...readLog(logKey(GUEST_OWNER)), ...unsynced]));
  }
  removeItem(LEGACY_STORAGE_KEY);
  progressVersion.value += 1;
}
// Before the first render reads the guest log, not only at the first sign-in.
migrateLegacyLog();

/**
 * Switches the attempt log to `userId`'s (null: the guest's). Call it on
 * every sign-in, sign-out and account change, before setSyncEnabled().
 *
 * Signing in adopts the guest log into the account once — answers given
 * before signing in count for that account and are backfilled by the next
 * sync — and empties it, so a later guest or account never sees them.
 * Signing out switches to the (empty) guest log; the account's own log
 * stays on this device but is not shown until that account signs in again.
 */
export function setProgressOwner(userId: string | null): void {
  migrateLegacyLog();
  const owner = userId ? `user:${userId}` : GUEST_OWNER;
  if (owner !== GUEST_OWNER) {
    const guestRows = readLog(logKey(GUEST_OWNER));
    if (guestRows.length > 0) {
      const adopted = guestRows.map((a) => ({ ...a, synced: false }));
      setItem(logKey(owner), JSON.stringify([...readLog(logKey(owner)), ...adopted]));
      removeItem(logKey(GUEST_OWNER));
    }
  }
  if (owner !== progressOwner) {
    progressOwner = owner;
    progressVersion.value += 1;
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
  syncEpoch += 1;
  syncStatus.value = enabled ? "syncing" : "off";
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
function markAttemptSynced(key: string, questionId: string, attemptedAt: string): void {
  try {
    const attempts = readLog(key);
    const row = attempts.find((a) => a.questionId === questionId && a.attemptedAt === attemptedAt);
    if (row && !row.synced) {
      row.synced = true;
      setItem(key, JSON.stringify(attempts));
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
  // The row belongs to whoever is signed in now, even if its POST settles
  // after a switch to another owner's log.
  const key = logKey();
  try {
    const attempts = readLog(key);
    attempts.push({ questionId, domain, correct, attemptedAt });
    setItem(key, JSON.stringify(attempts));
    progressVersion.value += 1;
  } catch {
    // Ignore storage errors
  }

  if (syncEnabled) {
    const epoch = syncEpoch;
    const send = () => {
      trackWrite(postAttemptToServer(questionId, domain, correct)).then((ok) => {
        if (ok) markAttemptSynced(key, questionId, attemptedAt);
        else setSyncStatusFor(epoch, "failed");
      });
    };
    if (writesHeldBy) queuedWrites.push({ epoch, send });
    else send();
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
export async function syncFromServer(): Promise<SyncOutcome> {
  if (!syncEnabled) return "disabled";
  if (clearInFlight) return "deferred";

  const startGeneration = clearGeneration;
  const epoch = syncEpoch;
  const key = logKey();
  setSyncStatusFor(epoch, "syncing");

  let serverAttempts: QuestionAttempt[];
  try {
    const res = await fetch(ATTEMPTS_ENDPOINT, { credentials: "same-origin" });
    if (!res.ok) {
      setSyncStatusFor(epoch, "failed");
      return "failed";
    }
    const data = await res.json();
    // A body without an attempts array is a failed read, not an empty history.
    if (!Array.isArray(data?.attempts)) {
      setSyncStatusFor(epoch, "failed");
      return "failed";
    }
    serverAttempts = data.attempts;
  } catch {
    setSyncStatusFor(epoch, "failed");
    return "failed";
  }

  // A clear started while this read was in flight. Its own result decides
  // the status (clearProgress sets synced/failed when it settles), so this
  // stale read must not touch it.
  if (clearGeneration !== startGeneration) return "deferred";
  // The account changed while this read was in flight: its rows belong to
  // the previous account's log, and backfilling now would post that log's
  // rows on the new account's session.
  if (epoch !== syncEpoch) return "deferred";

  const local = readLog(key);
  const localLatestByQuestion = new Map(latestPerQuestion(local).map((a) => [a.questionId, a]));

  const newFromServer = serverAttempts.filter((a) => {
    const existing = localLatestByQuestion.get(a.questionId);
    return !existing || new Date(a.attemptedAt).getTime() > new Date(existing.attemptedAt).getTime();
  });

  if (newFromServer.length > 0) {
    try {
      const withServerRows = [...local, ...newFromServer.map((a) => ({ ...a, synced: true }))];
      setItem(key, JSON.stringify(withServerRows));
      progressVersion.value += 1;
    } catch {
      // Ignore storage errors; fall through so backfill still gets attempted.
    }
  }

  const serverLatestByQuestion = new Map(serverAttempts.map((a) => [a.questionId, a]));
  const backfills: Promise<boolean>[] = [];
  for (const a of localLatestByQuestion.values()) {
    if (a.synced) continue;

    const serverRecord = serverLatestByQuestion.get(a.questionId);
    const serverIsUpToDate =
      serverRecord && new Date(serverRecord.attemptedAt).getTime() >= new Date(a.attemptedAt).getTime();
    if (serverIsUpToDate) {
      markAttemptSynced(key, a.questionId, a.attemptedAt);
      continue;
    }

    backfills.push(
      trackWrite(postAttemptToServer(a.questionId, a.domain, a.correct)).then((ok) => {
        if (ok) markAttemptSynced(key, a.questionId, a.attemptedAt);
        return ok;
      }),
    );
  }

  const results = await Promise.all(backfills);
  // A clear may have started while the backfills were in flight; its own
  // result owns the status from then on.
  if (clearGeneration !== startGeneration) return "deferred";
  const outcome: SyncOutcome = results.every(Boolean) ? "synced" : "failed";
  setSyncStatusFor(epoch, outcome);
  return outcome;
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
 * syncFromServer() does not race a concurrent GET against it either, and an
 * answer recorded before the DELETE resolves is queued (see `queuedWrites`)
 * and sent after it, so the DELETE cannot erase it on the server.
 */
export async function clearProgress(): Promise<{ serverCleared: boolean }> {
  clearGeneration += 1;
  // Answers held back by an earlier, overlapping clear belong to rows this
  // clear is about to wipe locally; sending them later would resurrect them.
  queuedWrites = [];
  try {
    removeItem(logKey());
    progressVersion.value += 1;
    progressEpoch.value = String(Date.now());
    setItem("academy.progress.epoch", progressEpoch.value);
  } catch {
    // Ignore
  }

  if (!syncEnabled) {
    return { serverCleared: true };
  }

  // The clear's outcome is the status: once the server copy is deleted,
  // device and server agree (both empty); if not, the server may still hold
  // rows the next sync would bring back. This also settles a "syncing" left
  // by a sync that deferred to this clear.
  const epoch = syncEpoch;
  setSyncStatusFor(epoch, "syncing");

  let markDone!: () => void;
  const thisClear = new Promise<void>((resolve) => {
    markDone = resolve;
  });
  clearInFlight = thisClear;
  writesHeldBy = thisClear;

  try {
    // A while loop, not a one-time snapshot: recordAttempt() can add a new
    // entry to pendingWrites while this await is suspended (a learner
    // answering a question mid-clear), and that entry must be waited on too
    // — otherwise its POST could still land on the server after the DELETE
    // below and silently resurrect the very row being cleared.
    while (pendingWrites.size > 0) {
      await Promise.allSettled([...pendingWrites]);
    }
    const res = await fetch(ATTEMPTS_ENDPOINT, { method: "DELETE", credentials: "same-origin" });
    // The server has now ordered the DELETE, so answers recorded during the
    // clear can be sent without being erased by it.
    releaseQueuedWrites(thisClear);
    // An answer recorded during the clear whose POST failed is still only on
    // this device, so a confirmed DELETE alone does not mean "synced". Writes
    // still in flight are waited for first, so one that is merely slow is not
    // reported as a failure.
    if (res.ok) {
      while (pendingWrites.size > 0) {
        await Promise.allSettled([...pendingWrites]);
      }
    }
    const unsyncedLeft = getStoredAttempts().some((a) => !a.synced);
    setSyncStatusFor(epoch, res.ok && !unsyncedLeft ? "synced" : "failed");
    return { serverCleared: res.ok };
  } catch {
    setSyncStatusFor(epoch, "failed");
    return { serverCleared: false };
  } finally {
    markDone();
    // Only clear the lock if a later, overlapping clearProgress() call
    // hasn't already replaced it with its own — otherwise a rapid
    // double-clear would let this (earlier) call's finally null out the
    // second call's still-in-progress lock, letting syncFromServer() race it.
    if (clearInFlight === thisClear) {
      clearInFlight = null;
    }
    // A DELETE that threw never reached the release above.
    releaseQueuedWrites(thisClear);
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
      solvedPercent: stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0,
      unseenQuestions: stats.total - stats.attempted,
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
    totalUnseen: bundle.length - totalAttempted,
    solvedPercent: bundle.length > 0 ? Math.round((totalCorrect / bundle.length) * 100) : 0,
    domainProgress: domainProgress.sort((a, b) => a.domainId.localeCompare(b.domainId)),
  };
}
