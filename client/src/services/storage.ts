/**
 * localStorage with a memory fallback.
 *
 * Storage genuinely is not always there: private browsing can throw on write,
 * a full quota throws, and the jsdom environment the client tests run in has
 * no localStorage at all. Every read and write in the app goes through here so
 * a missing store degrades to "this session only" instead of throwing halfway
 * through recording an attempt or selecting a course.
 */
let memoryFallback: Record<string, string> = {};

function backing(): Storage | null {
  try {
    if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.getItem === "function") {
      return localStorage;
    }
  } catch {
    // Access itself can throw (blocked cookies/storage).
  }
  return null;
}

export function getItem(key: string): string | null {
  try {
    const store = backing();
    if (store) return store.getItem(key);
  } catch {
    // fall through to memory
  }
  return memoryFallback[key] ?? null;
}

export function setItem(key: string, value: string): void {
  try {
    const store = backing();
    if (store) {
      store.setItem(key, value);
      return;
    }
  } catch {
    // fall through to memory
  }
  memoryFallback[key] = value;
}

export function removeItem(key: string): void {
  try {
    const store = backing();
    if (store) {
      store.removeItem(key);
      return;
    }
  } catch {
    // fall through to memory
  }
  delete memoryFallback[key];
}

/** Clears both the real store and the fallback. Tests own this. */
export function resetStorage(): void {
  memoryFallback = {};
  try {
    backing()?.clear();
  } catch {
    // ignore
  }
}
