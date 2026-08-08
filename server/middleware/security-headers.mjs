/**
 * Baseline security response headers (PLAN.md Track A, PR2b).
 *
 * style-src keeps 'unsafe-inline': the React client still sets inline
 * `style={{...}}` props in several components (App.tsx, UserNav.tsx,
 * DashboardScreen.tsx), which the browser treats as an inline style
 * attribute for CSP purposes regardless of it being JS-set rather than
 * markup. Tightening style-src is scoped to the PR6 Vue/@mctlhq/css
 * migration, which replaces that pattern with external stylesheets rather
 * than working around it here. script-src has no such constraint — the
 * client ships no inline scripts, only the hashed Vite bundle — so it stays
 * strict.
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
