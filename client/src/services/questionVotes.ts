export type VoteValue = -1 | 1;

export interface VoteSummary {
  score: number;
  userValue: -1 | 0 | 1;
}

function votesEndpoint(questionId: string): string {
  return `/api/votes/${encodeURIComponent(questionId)}`;
}

/**
 * Same fetch conventions as services/progressStore.ts's attempt sync calls:
 * same-origin credentials (the session cookie), and `res.ok` checked
 * explicitly since fetch() does not reject on a non-2xx response. This
 * endpoint is fully auth-gated (see server/routes/votes.mjs), so callers
 * should only invoke these once a signed-in user is known to exist —
 * a 401 here surfaces as a thrown error rather than a silent no-op, since
 * (unlike attempt sync) there is no anonymous/local fallback for a vote.
 */
async function requestVoteSummary(questionId: string, init?: RequestInit): Promise<VoteSummary> {
  const res = await fetch(votesEndpoint(questionId), { credentials: "same-origin", ...init });
  if (!res.ok) {
    throw new Error(`Vote request failed with status ${res.status}`);
  }
  const data = await res.json();
  return { score: data.score, userValue: data.userValue };
}

export function fetchVoteSummary(questionId: string): Promise<VoteSummary> {
  return requestVoteSummary(questionId);
}

export function castVote(questionId: string, value: VoteValue): Promise<VoteSummary> {
  return requestVoteSummary(questionId, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

export function removeVote(questionId: string): Promise<VoteSummary> {
  return requestVoteSummary(questionId, { method: "DELETE" });
}
