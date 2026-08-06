/**
 * Minimal S3/R2 client. No SDK dependency on purpose: this runs in CI on every
 * content PR, and the whole job is GET one object and PUT one object.
 *
 * Snapshots are keyed by the SHA-256 of their own bytes, which makes the store
 * content-addressed: an object either matches its key or it is corrupt, and
 * there is no such thing as "the newer version of the same key".
 */
import { createHash, createHmac } from "node:crypto";

const REGION = "auto";
const SERVICE = "s3";

const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

export class SnapshotStore {
  /**
   * @param {object} cfg
   * @param {string} cfg.accountId  Cloudflare account id (the R2 endpoint host)
   * @param {string} cfg.accessKeyId
   * @param {string} cfg.secretAccessKey
   * @param {string} cfg.bucket
   */
  constructor({ accountId, accessKeyId, secretAccessKey, bucket }) {
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
      throw new Error("SnapshotStore: accountId, accessKeyId, secretAccessKey and bucket are all required");
    }
    this.host = `${accountId}.r2.cloudflarestorage.com`;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.bucket = bucket;
  }

  /** Build the SigV4 Authorization header for one request. */
  #sign(method, path, payloadHash, amzDate) {
    const dateStamp = amzDate.slice(0, 8);
    const canonicalHeaders =
      `host:${this.host}\n` + `x-amz-content-sha256:${payloadHash}\n` + `x-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

    const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      scope,
      sha256(canonicalRequest),
    ].join("\n");

    let key = hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    key = hmac(key, REGION);
    key = hmac(key, SERVICE);
    key = hmac(key, "aws4_request");
    const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

    return `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  }

  async #request(method, key, body) {
    const path = `/${this.bucket}/${key}`;
    const payload = body ?? Buffer.alloc(0);
    const payloadHash = sha256(payload);
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");

    const res = await fetch(`https://${this.host}${path}`, {
      method,
      headers: {
        "x-amz-date": amzDate,
        "x-amz-content-sha256": payloadHash,
        Authorization: this.#sign(method, path, payloadHash, amzDate),
      },
      body: method === "PUT" ? payload : undefined,
    });
    return res;
  }

  /**
   * Fetch a snapshot and verify it hashes to its own key.
   *
   * Returns null when the object does not exist — a missing snapshot is an
   * expected state (nothing has been captured for this source yet), not an
   * error. A hash mismatch IS an error: it means the store handed back bytes
   * that are not what was captured, and no citation checked against them
   * would mean anything.
   */
  async get(key) {
    const res = await this.#request("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`snapshot GET ${key} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    const text = await res.text();
    const actual = sha256(Buffer.from(text, "utf8"));
    if (actual !== key) {
      throw new Error(
        `snapshot ${key} is corrupt: stored bytes hash to ${actual}. ` +
          "The store is content-addressed, so this means the object was overwritten or truncated.",
      );
    }
    return text;
  }

  /** Store a snapshot under its own content hash. Returns the key. */
  async put(text) {
    const payload = Buffer.from(text, "utf8");
    const key = sha256(payload);
    const res = await this.#request("PUT", key, payload);
    if (!res.ok) {
      throw new Error(`snapshot PUT ${key} failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    return key;
  }
}

/** Build a store from the environment, or return null when unconfigured. */
export function storeFromEnv() {
  const {
    R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY,
    R2_BUCKET = "academy-source-snapshots",
  } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) return null;
  return new SnapshotStore({
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucket: R2_BUCKET,
  });
}

export { sha256 };
