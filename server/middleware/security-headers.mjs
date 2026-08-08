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
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'"
].join("; ");

export async function securityHeaders(c, next) {
  await next();
  c.header("Content-Security-Policy", CSP);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  // HTTPS is terminated at the ingress; NODE_ENV=production is this app's
  // existing signal for "we are behind that ingress" (see db-ssl.mjs), so
  // HSTS is scoped to it rather than sent from a plain-HTTP local dev server.
  if (process.env.NODE_ENV === "production") {
    c.header("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  }
}
