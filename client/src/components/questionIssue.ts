export const QUESTION_ISSUES_URL = "https://github.com/mctlhq/mctl-academy/issues/new";

export const questionIssueReasons = [
  { label: "Typo or formatting error", value: "typo" },
  { label: "Factual or technical inaccuracy", value: "factual_error" },
  { label: "Unclear or ambiguous question stem", value: "unclear_stem" },
  { label: "Incorrect or ambiguous answer options", value: "bad_distractor" },
  { label: "Other feedback", value: "other" },
];

export function buildQuestionIssueUrl(questionId: string, reason: string, comment: string) {
  const reasonLabel =
    questionIssueReasons.find((option) => option.value === reason)?.label ?? "Other feedback";
  const details = comment.trim() || "_No additional details provided._";
  const body = [
    `**Question ID:** \`${questionId}\``,
    `**Issue type:** ${reasonLabel}`,
    "",
    "**Details**",
    details,
    "",
    "_Submitted from mctl Academy._",
  ].join("\n");

  const query = new URLSearchParams({
    title: `[Question ${questionId}] ${reasonLabel}`,
    body,
  });
  return `${QUESTION_ISSUES_URL}?${query.toString()}`;
}
