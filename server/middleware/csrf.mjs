/**
 * Reject state-changing browser requests from a different origin.
 *
 * The API is same-origin and does not enable CORS. SameSite cookies are the
 * primary protection; this check supplies defence in depth for browsers that
 * send Origin or Fetch Metadata headers. Non-browser clients without either
 * header remain supported for scripted API testing.
 */
export function requireSameOrigin(c, next) {
  const origin = c.req.header("origin");
  const fetchSite = c.req.header("sec-fetch-site");
  const expectedOrigin = process.env.PUBLIC_BASE_URL || new URL(c.req.url).origin;

  if ((origin && origin !== expectedOrigin) || fetchSite === "cross-site") {
    return c.json({ error: "Cross-origin request rejected." }, 403);
  }

  return next();
}
