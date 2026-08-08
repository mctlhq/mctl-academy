const STORAGE_KEY = "academy.theme";

export type Theme = "dark" | "light";

function systemPreference(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Applies data-theme/data-accent on <html>. @mctlhq/css is attribute-driven, not prefers-color-scheme-driven. */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.dataset.accent = "cyan";
  const themeColor = theme === "dark" ? "#0a0b0d" : "#f5f2ea";
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    meta.content = themeColor;
  });
}

/** Reads a persisted choice, falling back to the OS preference on first visit. */
export function initTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY);
  const theme: Theme = stored === "dark" || stored === "light" ? stored : systemPreference();
  applyTheme(theme);
  return theme;
}

export function setTheme(theme: Theme): void {
  localStorage.setItem(STORAGE_KEY, theme);
  applyTheme(theme);
}

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}
