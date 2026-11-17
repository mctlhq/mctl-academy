/**
 * The SPA's fixed page paths, shared by the client router and the server.
 *
 * server/spa.mjs answers 200 only for these, for /courses/<id> with an id in
 * the course catalog, and 404 for everything else. client/src/router/index.ts
 * keeps the route table (components, titles); router.test.ts asserts that its
 * static paths are exactly this list, so a page added to the router without
 * being added here fails CI instead of silently serving a 404 status.
 */
export const STATIC_SPA_PATHS = Object.freeze([
  "/",
  "/practice",
  "/mistakes",
  "/mock",
  "/dashboard",
  "/admin/stats",
]);

/** The router's `/courses/:courseId` route, as a prefix. */
export const COURSE_PATH_PREFIX = "/courses/";

/**
 * Pages kept out of search results: per-learner views and the admin page.
 * The single rule both the X-Robots-Tag header
 * (server/middleware/security-headers.mjs) and the page's own robots meta
 * and canonical (server/spa.mjs) follow. When they were decided separately,
 * these pages sent `noindex` in the header and `index` plus the home
 * canonical in the HTML.
 */
export const NOINDEX_PATH_PREFIXES = Object.freeze(["/mock", "/dashboard", "/mistakes", "/admin"]);

/**
 * Whole-segment prefix match (`/mockery` is not `/mock`), case-insensitive
 * and with an optional trailing slash, the way vue-router and
 * classifySpaPath match pages: `/Mock` is the same page as `/mock`.
 */
export function isNoindexRoute(path = "") {
  const lower = String(path).toLowerCase();
  return NOINDEX_PATH_PREFIXES.some(
    (prefix) => lower === prefix || lower.startsWith(prefix + "/") || lower.startsWith(prefix + "?"),
  );
}
