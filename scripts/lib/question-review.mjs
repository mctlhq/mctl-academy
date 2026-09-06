import { createHash } from "node:crypto";

export const AGENT_ID = /^agent:[a-z0-9][a-z0-9-]*$/;

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
  if (review.by.startsWith("agent:")) {
    if (!AGENT_ID.test(review.by)) reasons.push("invalid agent reviewer identifier");
    if (review.by === question.authored?.by) reasons.push("agent self-review is not allowed");
    if (!review.content_sha256) reasons.push("agent approval requires content_sha256");
  }
  if (review.content_sha256 && review.content_sha256 !== questionFingerprint(question)) {
    reasons.push("review content_sha256 is stale; fresh review is required");
  }
  return reasons;
}
