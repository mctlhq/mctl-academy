import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { randomUUID } from "node:crypto";
import { upsertUser, createSession, getSessionUser, deleteSession } from "../db.mjs";

export const authRouter = new Hono();

const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "";
const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || "";
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || "";

// GET /api/auth/github - Redirect to GitHub OAuth
authRouter.get("/github", (c) => {
  if (!GITHUB_CLIENT_ID) {
    return c.json({ error: "GitHub OAuth is not configured on this server." }, 503);
  }

  const state = randomUUID();
  setCookie(c, "mctl_oauth_state", state, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes
    sameSite: "Lax",
  });

  const redirectUri = `${PUBLIC_BASE_URL || c.req.url.split("/api/auth")[0]}/api/auth/github/callback`;
  const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=read:user&state=${state}`;

  return c.redirect(githubAuthUrl);
});

// GET /api/auth/github/callback - Exchange code for token & authenticate
authRouter.get("/github/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const savedState = getCookie(c, "mctl_oauth_state");

  deleteCookie(c, "mctl_oauth_state");

  if (!code || !state || state !== savedState) {
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
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
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

    setCookie(c, "mctl_session", token, {
      path: "/",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 7 * 24 * 60 * 60, // 7 days
      sameSite: "Lax",
    });

    return c.redirect("/");
  } catch (err) {
    console.error("[auth] OAuth callback error:", err);
    return c.json({ error: "Authentication failed due to internal error." }, 500);
  }
});

// GET /api/auth/me - Retrieve current logged-in user
authRouter.get("/me", async (c) => {
  const token = getCookie(c, "mctl_session");
  if (!token) {
    return c.json({ authenticated: false, user: null });
  }

  const user = await getSessionUser(token);
  if (!user) {
    deleteCookie(c, "mctl_session");
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
authRouter.post("/logout", async (c) => {
  const token = getCookie(c, "mctl_session");
  if (token) {
    await deleteSession(token);
    deleteCookie(c, "mctl_session");
  }
  return c.json({ success: true, message: "Logged out successfully." });
});
