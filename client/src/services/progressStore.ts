import rawBundle from "../content-bundle.json";

export interface QuestionAttempt {
  questionId: string;
  domain: string;
  correct: boolean;
  courseId?: string;
  attemptedAt: string;
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

let memoryFallback: Record<string, string> = {};
let syncEnabled = false;

function getItem(key: string): string | null {
  try {
    if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.getItem === "function") {
      return localStorage.getItem(key);
    }
  } catch {}
  return memoryFallback[key] ?? null;
}

function setItem(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.setItem === "function") {
      localStorage.setItem(key, value);
      return;
    }
  } catch {}
  memoryFallback[key] = value;
}

export function saveRawAttempts(attempts: QuestionAttempt[]): void {
  setItem(STORAGE_KEY, JSON.stringify(attempts));
}

function removeItem(key: string): void {
  try {
    if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.removeItem === "function") {
      localStorage.removeItem(key);
      return;
    }
  } catch {}
  delete memoryFallback[key];
}

export function resetMemoryFallback(): void {
  memoryFallback = {};
  try {
    if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.clear === "function") {
      localStorage.clear();
    }
  } catch {}
}

const DOMAIN_TITLES: Record<string, string> = {
  "domain-1": "Domain 1: Inference API & Compatibility",
  "domain-2": "Domain 2: Agent Architecture & Orchestration",
  "domain-3": "Domain 3: Data & Post-Training",
  "domain-4": "Domain 4: Production Operations",
};

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

export function recordAttempt(questionId: string, domain: string, correct: boolean, courseId?: string): void {
  try {
    const attempts = getStoredAttempts();
    const updated = attempts.filter((a) => a.questionId !== questionId);
    updated.push({
      questionId,
      domain,
      correct,
      courseId,
      attemptedAt: new Date().toISOString(),
    });
    setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
  }

  if (syncEnabled) {
    postAttemptToServer(questionId, domain, correct);
  }
}

/**
 * Pulls the signed-in learner's server-recorded attempts (a single
 * GET /api/attempts call) and merges them into local storage, keeping
 * whichever of the local or server record is newer per questionId. Any
 * local attempt whose questionId the server did not already have is then
 * backfilled with an individual POST /api/attempts call, so history built
 * up anonymously survives a first sign-in. A no-op while sync is disabled,
 * and any network failure leaves local data untouched.
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
  const serverIds = new Set(serverAttempts.map((a) => a.questionId));

  const merged = new Map<string, QuestionAttempt>();
  for (const a of local) {
    merged.set(a.questionId, a);
  }
  for (const a of serverAttempts) {
    const existing = merged.get(a.questionId);
    if (!existing || new Date(a.attemptedAt).getTime() > new Date(existing.attemptedAt).getTime()) {
      merged.set(a.questionId, a);
    }
  }

  try {
    setItem(STORAGE_KEY, JSON.stringify([...merged.values()]));
  } catch {
    // Ignore storage errors; fall through so backfill still gets attempted.
  }

  for (const a of local) {
    if (!serverIds.has(a.questionId)) {
      postAttemptToServer(a.questionId, a.domain, a.correct);
    }
  }
}

export function getMistakeQuestionIds(): string[] {
  const attempts = getStoredAttempts();
  return attempts.filter((a) => !a.correct).map((a) => a.questionId);
}

export function clearProgress(): void {
  try {
    removeItem(STORAGE_KEY);
  } catch {
    // Ignore
  }
}

export function calculateProgressStats(
  bundle: Array<{ id: string; domain: string }> = rawBundle as Array<{ id: string; domain: string }>,
  attempts: QuestionAttempt[] = getStoredAttempts(),
): OverallProgress {
  const attemptsMap = new Map<string, QuestionAttempt>();
  for (const a of attempts) {
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
      domainTitle: DOMAIN_TITLES[domainId] || domainId,
      totalQuestions: stats.total,
      attemptedQuestions: stats.attempted,
      correctQuestions: stats.correct,
      accuracy,
    });
  }

  for (const a of attemptsMap.values()) {
    if (!a.correct) {
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
