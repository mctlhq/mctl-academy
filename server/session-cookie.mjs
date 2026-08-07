/**
 * Session cookie naming, shared by every route that reads or writes it.
 *
 * Production uses the `__Host-` prefix, which browsers only accept on a cookie
 * that is Secure, path=/ and has no Domain attribute - so it cannot be set by a
 * subdomain or over plain HTTP. The prefix is dropped outside production so
 * local HTTP development and the test suite still work.
 *
 * This lives in its own module because the name must agree across auth.mjs,
 * attempts.mjs and app.mjs. When it was duplicated, production sent
 * `__Host-mctl_session` from auth and read `mctl_session` in attempts, which
 * silently 401'd every attempt sync for signed-in learners while tests - which
 * do not run as production - passed.
 */

export const isProduction = () => process.env.NODE_ENV === "production";

export const cookieName = (name) => (isProduction() ? `__Host-${name}` : name);

export const sessionCookieName = () => cookieName("mctl_session");

export function cookieOptions(maxAge) {
  return {
    path: "/",
    httpOnly: true,
    secure: isProduction(),
    maxAge,
    sameSite: "Lax",
  };
}
