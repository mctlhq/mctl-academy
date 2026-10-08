import { createAuthClient } from "better-auth/vue";
import { genericOAuthClient } from "better-auth/client/plugins";

/**
 * baseURL is intentionally omitted: the client is served from the same
 * origin as /api/auth/* (see server/app.mjs), so a relative default is
 * correct in every environment and avoids hardcoding academy.mctl.ai.
 */
export const authClient = createAuthClient({
  // signIn.oauth2, for the optional ZITADEL sign-in (server/auth.mjs).
  plugins: [genericOAuthClient()],
});
