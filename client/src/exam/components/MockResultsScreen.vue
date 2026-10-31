<script setup lang="ts">
import { computed, ref } from "vue";
import { MButton } from "@mctlhq/ui";
import type { ExamSessionState } from "../session";
import { scoreSession } from "../session";
import { domainTitlesFor } from "../../services/courseCatalog";
import RestrictedMarkdown from "./RestrictedMarkdown.vue";

const props = defineProps<{ session: ExamSessionState; courseId?: string }>();
defineEmits<{ restart: [] }>();

type Outcome = "correct" | "incorrect" | "unanswered";
type Filter = "all" | "incorrect" | "unanswered";

const score = computed(() => scoreSession(props.session));
const domainTitles = computed(() => domainTitlesFor(props.courseId));

// Unanswered is its own outcome, never folded into "incorrect": a learner
// who ran out of time needs a different next step from one who answered
// wrongly. The three counts always add up to the total.
const rows = computed(() =>
  props.session.questions.map((question, index) => {
    const scored = score.value.perQuestion[index];
    const outcome: Outcome =
      scored.selectedOptionId === undefined ? "unanswered" : scored.isCorrect ? "correct" : "incorrect";
    return { question, index, outcome };
  }),
);

const counts = computed(() => {
  const c = { correct: 0, incorrect: 0, unanswered: 0 };
  for (const row of rows.value) c[row.outcome] += 1;
  return c;
});

const domains = computed(() => {
  const byDomain = new Map<string, { id: string; title: string; correct: number; total: number }>();
  for (const row of rows.value) {
    const id = row.question.domain;
    const entry = byDomain.get(id) ?? { id, title: domainTitles.value[id] ?? id, correct: 0, total: 0 };
    entry.total += 1;
    if (row.outcome === "correct") entry.correct += 1;
    byDomain.set(id, entry);
  }
  return [...byDomain.values()];
});

/**
 * Lowest share correct; a tie goes to the domain that appears first in this
 * exam's questions. Undefined when every domain is perfect.
 */
const weakestDomain = computed(() => {
  let weakest: (typeof domains.value)[number] | undefined;
  for (const d of domains.value) {
    if (d.correct === d.total) continue;
    if (!weakest || d.correct / d.total < weakest.correct / weakest.total) weakest = d;
  }
  return weakest;
});

const filter = ref<Filter>("all");
const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "incorrect", label: "Incorrect" },
  { id: "unanswered", label: "Unanswered" },
];
const visibleRows = computed(() =>
  filter.value === "all" ? rows.value : rows.value.filter((row) => row.outcome === filter.value),
);

const outcomeLabel: Record<Outcome, string> = {
  correct: "✓ Correct",
  incorrect: "✗ Incorrect",
  unanswered: "– Not answered",
};
</script>

<template>
  <section class="mock-results" data-testid="mock-results">
    <h1>Results</h1>
    <p class="mock-results-score" data-testid="score">
      {{ score.correctCount }} / {{ score.totalCount }} correct
    </p>
    <ul class="mock-results-counts" aria-label="Summary">
      <li class="count-correct">
        <strong>{{ counts.correct }}</strong> correct
      </li>
      <li class="count-incorrect">
        <strong>{{ counts.incorrect }}</strong> incorrect
      </li>
      <li class="count-unanswered">
        <strong>{{ counts.unanswered }}</strong> unanswered
      </li>
    </ul>

    <div class="mock-results-actions">
      <a v-if="counts.incorrect + counts.unanswered > 0" href="/mistakes" class="mock-results-link primary"
        >Review mistakes</a
      >
      <a
        v-if="weakestDomain"
        :href="`/practice?domain=${encodeURIComponent(weakestDomain.id)}`"
        class="mock-results-link"
        >Practice {{ weakestDomain.title }}</a
      >
      <MButton type="button" variant="ghost" class="mock-restart" @click="$emit('restart')"
        >Start a new mock exam</MButton
      >
    </div>

    <section class="mock-results-domains" aria-labelledby="mock-results-domains-title">
      <h2 id="mock-results-domains-title">By domain</h2>
      <ul>
        <li v-for="d in domains" :key="d.id">
          <span>{{ d.title }}</span>
          <span class="domain-score">{{ d.correct }} / {{ d.total }}</span>
        </li>
      </ul>
    </section>

    <section aria-labelledby="mock-results-questions-title">
      <h2 id="mock-results-questions-title">Questions</h2>
      <div class="mock-results-filters" role="group" aria-label="Show questions">
        <button
          v-for="f in filters"
          :key="f.id"
          type="button"
          :aria-pressed="filter === f.id"
          :class="{ active: filter === f.id }"
          @click="filter = f.id"
        >
          {{ f.label }}
        </button>
      </div>
      <p v-if="visibleRows.length === 0" class="mock-results-none">No questions in this view.</p>
      <ol class="mock-results-list">
        <li
          v-for="row in visibleRows"
          :key="row.question.id"
          class="mock-results-question"
          :class="row.outcome"
          :value="row.index + 1"
        >
          <details>
            <summary>
              <span class="outcome">{{ outcomeLabel[row.outcome] }}</span>
              <span class="mock-results-stem"><RestrictedMarkdown :text="row.question.stem" /></span>
            </summary>
            <ul class="mock-results-options">
              <li
                v-for="option in row.question.options"
                :key="option.id"
                class="mock-results-option"
                :class="{ correct: option.correct, selected: option.id === session.answers[row.question.id] }"
              >
                <p>
                  <RestrictedMarkdown :text="option.text" />
                  <span v-if="option.correct" class="tag">✓ Correct answer</span>
                  <span v-if="option.id === session.answers[row.question.id]" class="tag">Your answer</span>
                </p>
                <p class="mock-results-explanation">
                  <RestrictedMarkdown :text="option.explanation" />
                </p>
              </li>
            </ul>
            <p v-if="row.outcome === 'unanswered'" class="mock-results-unanswered">Not answered.</p>
          </details>
        </li>
      </ol>
    </section>
  </section>
</template>

<style scoped>
/* Same reading width as PracticeContent.vue's `.practice` and
   MockExamScreen.vue's `.mock-exam` — see the comment there for why. */
.mock-results {
  width: min(100%, 43rem);
  margin: 0 auto;
}

.mock-results h2 {
  margin: 2rem 0 0.75rem;
  font-size: 1rem;
}

.mock-results-score {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 1.5rem;
}

.mock-results-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1.25rem;
  margin: 0.5rem 0 0;
  padding: 0;
  list-style: none;
  color: var(--surface-fg-muted);
}

.mock-results-counts strong {
  color: var(--surface-fg);
  font-family: var(--font-mono);
}

.mock-results-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.mock-results-link {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  padding: 0 1rem;
  border: 1px solid var(--surface-line-strong);
  border-radius: var(--mctl-radius-md, 6px);
  color: var(--surface-fg);
  text-decoration: none;
}

.mock-results-link.primary {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-fg);
}

.mock-results-domains ul {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--surface-line);
}

.mock-results-domains li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--surface-line);
}

.domain-score {
  flex: none;
  font-family: var(--font-mono);
}

.mock-results-filters {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.mock-results-filters button {
  min-height: 2.75rem;
  padding: 0 0.9rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-pill);
  background: transparent;
  color: var(--surface-fg-muted);
  font: inherit;
  cursor: pointer;
}

.mock-results-filters button.active {
  border-color: var(--surface-fg);
  color: var(--surface-fg);
}

.mock-results-list {
  padding-left: 1.75rem;
}

.mock-results-question {
  margin-bottom: 0.5rem;
  border-bottom: 1px solid var(--surface-line);
}

.mock-results-question summary {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.6rem 0;
  cursor: pointer;
  list-style: none;
}

.mock-results-question summary::-webkit-details-marker {
  display: none;
}

.outcome {
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.correct > details > summary .outcome {
  color: var(--status-ok);
}

.incorrect > details > summary .outcome {
  color: var(--status-bad);
}

.unanswered > details > summary .outcome {
  color: var(--surface-fg-muted);
}

.mock-results-option {
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md, 6px);
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.5rem;
  /* Was previously scoped to <=620px only; a long unbroken token (a code
     span not caught by the global `code` rule, or a bare long word) can
     force horizontal scroll at any width, not just on narrow screens. */
  overflow-wrap: break-word;
}

.mock-results-option.correct {
  background: color-mix(in srgb, var(--status-ok) 12%, transparent);
  border-color: var(--status-ok);
}

.mock-results-option.selected:not(.correct) {
  border-color: var(--status-bad);
}

.tag {
  margin-left: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--surface-fg-muted);
}

.mock-results-explanation {
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
}

@media (max-width: 620px) {
  .mock-results-list {
    padding-left: 1.25rem;
  }

  .mock-results-options {
    padding-left: 0;
    list-style: none;
  }
}
</style>
