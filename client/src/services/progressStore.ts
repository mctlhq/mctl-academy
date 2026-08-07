import rawBundle from "../content-bundle.json";

export interface QuestionAttempt {
  questionId: string;
  domain: string;
  correct: boolean;
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

let memoryFallback: Record<string, string> = {};

function getItem(key: string): string | null {
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(key);
  }
  return memoryFallback[key] ?? null;
}

function setItem(key: string, value: string): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(key, value);
  } else {
    memoryFallback[key] = value;
  }
}

function removeItem(key: string): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(key);
  } else {
    delete memoryFallback[key];
  }
}

export function resetMemoryFallback(): void {
  memoryFallback = {};
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
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

export function recordAttempt(questionId: string, domain: string, correct: boolean): void {
  try {
    const attempts = getStoredAttempts();
    const updated = attempts.filter((a) => a.questionId !== questionId);
    updated.push({
      questionId,
      domain,
      correct,
      attemptedAt: new Date().toISOString(),
    });
    setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // Ignore storage errors
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
