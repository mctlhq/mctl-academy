import { createAuthClient } from "better-auth/vue";

/**
 * baseURL is intentionally omitted: the client is served from the same
 * origin as /api/auth/* (see server/app.mjs), so a relative default is
 * correct in every environment and avoids hardcoding academy.mctl.ai.
 */
export const authClient = createAuthClient();
