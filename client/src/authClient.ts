import { createAuthClient } from "better-auth/vue";

/**
 * baseURL is intentionally omitted: the client is served from the same
 * origin as /api/auth/* (see server/app.mjs), so a relative default is
 * correct in every environment and avoids hardcoding academy.mctl.ai.
 *
 * No client plugin: since better-auth 1.7 the optional ZITADEL sign-in
 * (server/auth.mjs's generic OAuth provider) goes through the same
 * signIn.social as GitHub.
 */
export const authClient = createAuthClient();
