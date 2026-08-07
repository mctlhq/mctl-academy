import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { upsertUser, createSession, getSessionUser, deleteSession } from "../db.mjs";
import { requireSameOrigin } from "../middleware/csrf.mjs";
import { cookieName, cookieOptions, isProduction } from "../session-cookie.mjs";

export const authRouter = new Hono();

function oauthConfig(c) {
  const clientId = process.env.GITHUB_CLIENT_ID || "";
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || "";
  const configuredBaseUrl = process.env.PUBLIC_BASE_URL || "";

  if (!clientId || !clientSecret) return null;

  const baseUrl = configuredBaseUrl || new URL(c.req.url).origin;
  try {
    const parsed = new URL(baseUrl);
    if (isProduction() && (parsed.protocol !== "https:" || !configuredBaseUrl)) return null;
    return {
      clientId,
      clientSecret,
      redirectUri: new URL("/api/auth/github/callback", parsed).toString(),
    };
  } catch {
    return null;
  }
}

function randomVerifier() {
  return randomBytes(32).toString("base64url");
}

function codeChallenge(verifier) {
  return createHash("sha256").update(verifier).digest("base64url");
}

function sameValue(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

// GET /api/auth/github - Redirect to GitHub OAuth
authRouter.get("/github", (c) => {
  const config = oauthConfig(c);
  if (!config) {
    return c.json({ error: "GitHub OAuth is not configured on this server." }, 503);
  }

  const state = randomUUID();
  const verifier = randomVerifier();
  setCookie(c, cookieName("mctl_oauth_state"), state, cookieOptions(600));
  setCookie(c, cookieName("mctl_oauth_verifier"), verifier, cookieOptions(600));

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: "read:user",
    state,
    code_challenge: codeChallenge(verifier),
    code_challenge_method: "S256",
  });

  return c.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GET /api/auth/github/callback - Exchange code for token & authenticate
authRouter.get("/github/callback", async (c) => {
  const config = oauthConfig(c);
  if (!config) {
    return c.json({ error: "GitHub OAuth is not configured on this server." }, 503);
  }

  const code = c.req.query("code");
  const state = c.req.query("state");
  const savedState = getCookie(c, cookieName("mctl_oauth_state"));
  const verifier = getCookie(c, cookieName("mctl_oauth_verifier"));

  deleteCookie(c, cookieName("mctl_oauth_state"), cookieOptions(0));
  deleteCookie(c, cookieName("mctl_oauth_verifier"), cookieOptions(0));

  if (!code || !verifier || !sameValue(state, savedState)) {
    return c.json({ error: "Invalid OAuth state or missing authorization code." }, 400);
  }

  try {
    // Exchange code for access_token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
        code_verifier: verifier,
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return c.json({ error: "Failed to obtain GitHub access token." }, 400);
    }

    // Fetch user profile from GitHub API
    const userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "mctl-academy-app",
      },
    });

    const ghUser = await userRes.json();
    if (!ghUser.id || !ghUser.login) {
      return c.json({ error: "Failed to retrieve GitHub user profile." }, 400);
    }

    // Save/update user in DB
    const dbUser = await upsertUser({
      githubId: ghUser.id,
      githubLogin: ghUser.login,
      avatarUrl: ghUser.avatar_url,
    });

    // Create session token
    const { token } = await createSession(dbUser.id);

    setCookie(c, cookieName("mctl_session"), token, cookieOptions(7 * 24 * 60 * 60));

    return c.redirect("/");
  } catch (err) {
    console.error("[auth] OAuth callback error:", err);
    return c.json({ error: "Authentication failed due to internal error." }, 500);
  }
});

// GET /api/auth/me - Retrieve current logged-in user
authRouter.get("/me", async (c) => {
  const token = getCookie(c, cookieName("mctl_session"));
  if (!token) {
    return c.json({ authenticated: false, user: null });
  }

  const user = await getSessionUser(token);
  if (!user) {
    deleteCookie(c, cookieName("mctl_session"), cookieOptions(0));
    return c.json({ authenticated: false, user: null });
  }

  return c.json({
    authenticated: true,
    user: {
      id: user.id,
      githubId: user.githubId,
      githubLogin: user.githubLogin,
      avatarUrl: user.avatarUrl,
    },
  });
});

// POST /api/auth/logout - Clear session
authRouter.post("/logout", requireSameOrigin, async (c) => {
  const token = getCookie(c, cookieName("mctl_session"));
  if (token) {
    await deleteSession(token);
    deleteCookie(c, cookieName("mctl_session"), cookieOptions(0));
  }
  return c.json({ success: true, message: "Logged out successfully." });
});
