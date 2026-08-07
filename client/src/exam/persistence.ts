import type { ExamSessionState } from "./session";

// sessionStorage (tab/session-scoped), not localStorage: a reload mid-exam
// restores answers and remaining time for that browser session only, per
// requirements.md's "client-side persistence only" acceptance criterion.
// This is explicitly a convenience, not the server-side session authority
// PLAN.md requires for production trust.
const STORAGE_KEY = "academy.mock.session.v1";

export function saveSession(session: ExamSessionState): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // sessionStorage unavailable (private browsing, storage full, etc.) --
    // the session simply will not survive a reload.
  }
}

export function loadSession(): ExamSessionState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ExamSessionState;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
