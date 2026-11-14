/**
 * One structured log line for every /api/* response with status >= 400.
 *
 * Before this the app wrote nothing per request, so a failed sign-in or a
 * rejected attempt left no trace in the pod logs at all. The line is built
 * to carry no learner data:
 *
 * - the path only, never the query string: OAuth callbacks carry `code` and
 *   `state` there;
 * - no IP, user agent, cookies, user id or request body;
 * - an error code only when the JSON body carries a short, code-shaped
 *   `code` or `error` field (`unknown_question`, `INVALID_ORIGIN`). Free
 *   text is dropped rather than risk echoing anything a user typed.
 *
 * 2xx/3xx are not logged: the point is to see failures, not to build an
 * access log of who practised what.
 */

const CODE_SHAPE = /^[A-Za-z0-9_.:-]{1,64}$/;

/**
 * @param {Response} res
 * @returns {Promise<string | undefined>}
 */
async function errorCodeOf(res) {
  if (!res.headers.get("content-type")?.includes("application/json")) return undefined;
  try {
    const body = await res.clone().json();
    for (const candidate of [body?.code, body?.error]) {
      if (typeof candidate === "string" && CODE_SHAPE.test(candidate)) return candidate;
    }
  } catch {
    // An unreadable body is simply logged without a code.
  }
  return undefined;
}

/**
 * @param {{ method: string, path: string, status: number, ms: number, code?: string }} entry
 * @param {(line: string) => void} [write]
 */
export function writeRequestLog(entry, write = (line) => console.log(line)) {
  const level = entry.status >= 500 ? "error" : "warn";
  write(JSON.stringify({ level, msg: "api_response", ...entry }));
}

/**
 * @param {{ write?: (line: string) => void }} [options]
 */
export function apiErrorLog(options = {}) {
  return async function apiErrorLogMiddleware(c, next) {
    const started = performance.now();
    await next();
    const status = c.res.status;
    if (status < 400) return;
    const code = await errorCodeOf(c.res);
    writeRequestLog(
      {
        method: c.req.method,
        path: c.req.path,
        status,
        ms: Math.round(performance.now() - started),
        ...(code ? { code } : {}),
      },
      options.write,
    );
  };
}
