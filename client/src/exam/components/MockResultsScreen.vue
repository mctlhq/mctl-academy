<script setup lang="ts">
import { computed } from "vue";
import type { ExamSessionState } from "../session";
import { scoreSession } from "../session";
import RestrictedMarkdown from "./RestrictedMarkdown.vue";

const props = defineProps<{ session: ExamSessionState }>();

const score = computed(() => scoreSession(props.session));
</script>

<template>
  <section class="mock-results" data-testid="mock-results">
    <h1>Results</h1>
    <p class="mock-results-score" data-testid="score">
      {{ score.correctCount }} / {{ score.totalCount }} correct
    </p>

    <ol class="mock-results-list">
      <li v-for="question in session.questions" :key="question.id" class="mock-results-question">
        <p class="mock-results-stem">
          <RestrictedMarkdown :text="question.stem" />
        </p>
        <ul class="mock-results-options">
          <li
            v-for="option in question.options"
            :key="option.id"
            class="mock-results-option"
            :class="{ correct: option.correct, selected: option.id === session.answers[question.id] }"
          >
            <p>
              <RestrictedMarkdown :text="option.text" />
              <span v-if="option.correct" class="tag"> Correct answer</span>
              <span v-if="option.id === session.answers[question.id]" class="tag"> Your answer</span>
            </p>
            <p class="mock-results-explanation">
              <RestrictedMarkdown :text="option.explanation" />
            </p>
          </li>
        </ul>
        <p v-if="session.answers[question.id] === undefined" class="mock-results-unanswered">
          Not answered.
        </p>
      </li>
    </ol>
  </section>
</template>

<style scoped>
/* Same reading width as PracticeContent.vue's `.practice` and
   MockExamScreen.vue's `.mock-exam` — see the comment there for why. */
.mock-results {
  width: min(100%, 43rem);
  margin: 0 auto;
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
