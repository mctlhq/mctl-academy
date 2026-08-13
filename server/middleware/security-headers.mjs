/**
 * Baseline security response headers (PLAN.md Track A, PR2b).
 *
 * style-src keeps 'unsafe-inline' because the Vue client uses runtime style
 * bindings, which the browser treats as inline style attributes for CSP
 * purposes regardless of being JS-set rather than authored in markup. The
 * bindings compute a value that cannot be a static class (a percentage
 * width), so this is a property of how the UI renders rather than a
 * shortcut waiting to be tidied away. Deliberately stated as the reason
 * rather than as a list of files: an enumeration goes stale the moment a
 * component is added, renamed, or ported, and the previous version of this
 * comment had rotted into naming React `.tsx` files that no longer exist.
 *
 * script-src has no such constraint — the client ships no inline scripts,
 * only the hashed Vite bundle — so it stays strict.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://avatars.githubusercontent.com https://*.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

function securityHeaderEntries() {
  const entries = [
    ["Content-Security-Policy", CSP],
    // Redundant with the CSP's frame-ancestors 'none' for any browser that
    // implements CSP Level 2, and deliberately kept anyway: X-Frame-Options
    // is the only clickjacking control some embedded webviews and older
    // corporate browsers honour, and the two cannot disagree here because
    // both are emitted from this one list. DENY rather than SAMEORIGIN —
    // nothing in this app frames itself.
    ["X-Frame-Options", "DENY"],
    ["X-Content-Type-Options", "nosniff"],
    ["Referrer-Policy", "strict-origin-when-cross-origin"],
    ["Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()"]
  ];
  // HTTPS is terminated at the ingress; NODE_ENV=production is this app's
  // existing signal for "we are behind that ingress" (see db-ssl.mjs), so
  // HSTS is scoped to it rather than sent from a plain-HTTP local dev server.
  if (process.env.NODE_ENV === "production") {
    entries.push(["Strict-Transport-Security", "max-age=63072000; includeSubDomains"]);
  }
  return entries;
}

/**
 * Applies the baseline headers to whatever response `c` currently holds.
 * Shared between the middleware's success path and app.mjs's error handler
 * so a downstream handler throwing (unhandled, not one of the try/catch'd
 * routes) doesn't skip past the middleware's own `c.header()` calls and
 * ship a 500 with no security headers at all.
 */
export function applySecurityHeaders(c) {
  for (const [name, value] of securityHeaderEntries()) {
    c.header(name, value);
  }
}

/**
 * Same headers, applied directly to a Response object rather than through a
 * Hono context — for HTTPException's getResponse(), which builds its own
 * Response that app.mjs's errorHandler returns without ever assigning it to
 * c.res, so c.header() would have nothing to attach to. Safe to mutate:
 * getResponse() always builds via `new Response(...)` (see
 * hono/http-exception.js), never the immutable-header Response.redirect().
 */
export function applySecurityHeadersToResponse(res) {
  for (const [name, value] of securityHeaderEntries()) {
    res.headers.set(name, value);
  }
  return res;
}

export async function securityHeaders(c, next) {
  await next();
  applySecurityHeaders(c);
}
