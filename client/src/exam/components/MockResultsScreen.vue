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
.mock-results-option {
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md, 6px);
  padding: 0.6rem 0.75rem;
  margin-bottom: 0.5rem;
}

.mock-results-option.correct {
  background: color-mix(in srgb, var(--status-ok) 12%, transparent);
  border-color: var(--status-ok);
}

.mock-results-explanation {
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
}
</style>
