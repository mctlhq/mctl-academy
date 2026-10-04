import { createHash, generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";

/**
 * A fake ZITADEL issuer: discovery, a JWKS, a token endpoint that checks
 * client authentication and PKCE, and a userinfo endpoint. ID tokens are
 * RS256-signed with a real key, so every check the server makes runs
 * against real signatures; only the network is fake.
 */
export class FakeZitadel {
  constructor({
    issuer = "https://auth.example.com",
    clientId = "zitadel-client",
    clientSecret = "z-secret",
  } = {}) {
    this.issuer = issuer;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.rotateKey("kid-1");
    /** @type {Map<string, any>} */
    this.codes = new Map();
    /** Overrides merged into the discovery document. */
    this.discovery = {};
    /** What the userinfo endpoint answers, keyed by access token. */
    this.userinfo = new Map();
    this.hits = { discovery: 0, jwks: 0, token: 0, userinfo: 0 };
  }

  rotateKey(kid) {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.key = { privateKey, publicKey, kid };
  }

  async idToken(claims, { header = {}, key = this.key } = {}) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: this.issuer,
      aud: [this.clientId, "project-id"],
      azp: this.clientId,
      iat: now,
      exp: now + 3600,
      ...claims,
    };
    for (const name of Object.keys(payload)) if (payload[name] === undefined) delete payload[name];
    return new SignJWT(payload)
      .setProtectedHeader({ alg: "RS256", kid: key.kid, ...header })
      .sign(key.privateKey);
  }

  /** Register what the login carrying `authorizeUrl` returns for `code`. */
  approve(code, authorizeUrl, login) {
    const url = new URL(authorizeUrl);
    this.codes.set(code, { ...login, challenge: url.searchParams.get("code_challenge") });
  }

  fetch = async (input, init = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === `${this.issuer}/.well-known/openid-configuration`) {
      this.hits.discovery++;
      return Response.json({
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/oauth/v2/authorize`,
        token_endpoint: `${this.issuer}/oauth/v2/token`,
        userinfo_endpoint: `${this.issuer}/oidc/v1/userinfo`,
        jwks_uri: `${this.issuer}/oauth/v2/keys`,
        ...this.discovery,
      });
    }
    if (url === `${this.issuer}/oauth/v2/keys`) {
      this.hits.jwks++;
      const jwk = this.key.publicKey.export({ format: "jwk" });
      return Response.json({ keys: [{ ...jwk, kid: this.key.kid, use: "sig", alg: "RS256" }] });
    }
    if (url === `${this.issuer}/oauth/v2/token`) {
      this.hits.token++;
      const headers = new Headers(init.headers);
      const body = new URLSearchParams(String(init.body ?? ""));
      const basic = `Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64")}`;
      if (headers.get("authorization") !== basic) {
        return Response.json({ error: "invalid_client" }, { status: 401 });
      }
      const pending = this.codes.get(body.get("code"));
      const challenge = createHash("sha256")
        .update(body.get("code_verifier") ?? "")
        .digest("base64url");
      if (!pending || pending.challenge !== challenge) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      this.codes.delete(body.get("code"));
      return Response.json({
        access_token: `at-${pending.sub}`,
        token_type: "Bearer",
        expires_in: 3600,
        id_token: await this.idToken({
          sub: pending.sub,
          email: pending.email,
          name: pending.name,
          email_verified: true,
        }),
      });
    }
    if (url === `${this.issuer}/oidc/v1/userinfo`) {
      this.hits.userinfo++;
      const token = new Headers(init.headers).get("authorization")?.replace("Bearer ", "");
      const profile = this.userinfo.get(token);
      return profile ? Response.json(profile) : Response.json({}, { status: 401 });
    }
    return undefined;
  };
}
