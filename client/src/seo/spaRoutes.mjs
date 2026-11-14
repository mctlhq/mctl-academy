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
