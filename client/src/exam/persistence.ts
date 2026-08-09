import type { ExamSessionState } from "./session";

// sessionStorage (tab/session-scoped), not localStorage: a reload mid-exam
// restores answers and remaining time for that browser session only, per
// requirements.md's "client-side persistence only" acceptance criterion.
// This is explicitly a convenience, not the server-side session authority
// PLAN.md requires for production trust.
// Keyed per course: a mock belongs to the course it was started in, so a
// restored session must never resurface under a different course.
const STORAGE_PREFIX = "academy.mock.session.v1";

const storageKey = (courseId: string) => `${STORAGE_PREFIX}.${courseId}`;

export function saveSession(courseId: string, session: ExamSessionState): void {
  try {
    sessionStorage.setItem(storageKey(courseId), JSON.stringify(session));
  } catch {
    // sessionStorage unavailable (private browsing, storage full, etc.) --
    // the session simply will not survive a reload.
  }
}

export function loadSession(courseId: string): ExamSessionState | null {
  try {
    const raw = sessionStorage.getItem(storageKey(courseId));
    if (!raw) return null;
    return JSON.parse(raw) as ExamSessionState;
  } catch {
    return null;
  }
}

export function clearSession(courseId: string): void {
  try {
    sessionStorage.removeItem(storageKey(courseId));
  } catch {
    // ignore
  }
}
