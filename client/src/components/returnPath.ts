/**
 * The same-origin path a sign-in should come back to. Only a path on this
 * origin is ever accepted ("/practice?domain=x"); anything that could be read
 * as another origin ("//evil.example", "/\\evil.example", "https://...") or
 * that is not a string falls back to "/", so the OAuth callback can never be
 * turned into an open redirect.
 */
export function safeReturnPath(candidate: unknown): string {
  if (typeof candidate !== "string" || candidate.length === 0) return "/";
  if (!candidate.startsWith("/")) return "/";
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return "/";
  // Control characters (incl. tab/newline) are stripped by URL parsers and
  // can turn "/\t/evil" into "//evil".
  for (const ch of candidate) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) return "/";
  }
  return candidate;
}

/** The current location as a sign-in return target. */
export function currentReturnPath(): string {
  if (typeof window === "undefined") return "/";
  return safeReturnPath(`${window.location.pathname}${window.location.search}`);
}
