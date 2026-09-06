import { createHash } from "node:crypto";

export const AGENT_ID = /^agent:[a-z0-9][a-z0-9-]*$/;

/**
 * Approvals stamped from this instant on must carry a content fingerprint,
 * whoever stamps them. Earlier human approvals stay valid without one: they
 * were granted before the fingerprint existed, and re-stamping every historic
 * item would fabricate review timestamps. The promotion CLI always writes the
 * fingerprint, so only a hand-edited `reviewed` block can hit this rule.
 */
export const FINGERPRINT_REQUIRED_FROM = "2026-09-06T00:00:00Z";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/** Hash all question material, including author and evidence, but not lifecycle/review. */
export function questionFingerprint(question) {
  const material = Object.fromEntries(
    Object.entries(question).filter(([key]) => key !== "status" && key !== "reviewed"),
  );
  return createHash("sha256")
    .update(JSON.stringify(canonical(material)))
    .digest("hex");
}

export function reviewProblems(question) {
  const review = question?.reviewed;
  if (!review || typeof review.by !== "string" || !review.by.trim() || !review.at) {
    return ["published without a valid reviewed block — approval is not optional"];
  }
  const reasons = [];
  // An approval cannot predate the revision it approves. Without this, a
  // newly authored file could carry a backdated human `reviewed` block and
  // slip under the fingerprint cutoff below.
  const authoredAt = Date.parse(question.authored?.at ?? "");
  const reviewedAt = Date.parse(String(review.at));
  if (Number.isFinite(authoredAt) && Number.isFinite(reviewedAt) && reviewedAt < authoredAt) {
    reasons.push("reviewed.at precedes authored.at; an approval cannot predate the revision it approves");
  }
  if (review.by.startsWith("agent:")) {
    if (!AGENT_ID.test(review.by)) reasons.push("invalid agent reviewer identifier");
    if (review.by === question.authored?.by) reasons.push("agent self-review is not allowed");
    if (!review.content_sha256) reasons.push("agent approval requires content_sha256");
  } else if (!review.content_sha256 && String(review.at) >= FINGERPRINT_REQUIRED_FROM) {
    reasons.push(`approvals stamped from ${FINGERPRINT_REQUIRED_FROM} require content_sha256`);
  }
  if (review.content_sha256 && review.content_sha256 !== questionFingerprint(question)) {
    reasons.push("review content_sha256 is stale; fresh review is required");
  }
  return reasons;
}
