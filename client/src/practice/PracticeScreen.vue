<script setup lang="ts">
import { ref } from "vue";
import { MButton } from "@mctlhq/ui";
import { usePracticeSession, type BundleQuestion } from "./usePracticeSession";
import { renderInlineMarkdown } from "./renderInlineMarkdown";
import ReportModal from "../components/ReportModal.vue";

const props = withDefaults(
  defineProps<{
    /** Override the bundle read at build time — used by tests or custom filtering. */
    bundle?: readonly BundleQuestion[];
    title?: string;
    emptyMessage?: string;
  }>(),
  { title: "Practice" },
);

const { current, index, total, revealed, score, attempted, selectOption, next } = usePracticeSession(
  props.bundle,
);
const isReporting = ref(false);
</script>

<template>
  <main v-if="total === 0" class="practice practice-empty">
    <h1>{{ title }}</h1>
    <p v-if="emptyMessage">{{ emptyMessage }}</p>
    <p v-else>
      There are no published questions yet. Check back once the content bank has questions with
      <code>status: published</code>.
    </p>
  </main>

  <main v-else-if="!current" class="practice practice-summary">
    <h1>Session complete</h1>
    <p class="score">{{ score }} / {{ attempted }} correct on first try</p>
    <p class="meta">{{ total }} questions attempted this session.</p>
  </main>

  <main v-else class="practice">
    <div class="practice-header">
      <p class="progress">Question {{ index + 1 }} of {{ total }}</p>
      <MButton
        type="button"
        variant="ghost"
        size="sm"
        title="Report an issue with this question"
        @click="isReporting = true"
      >
        Report issue
      </MButton>
    </div>

    <!-- Restricted inline Markdown only: escaped text plus backtick code
         spans, matching build-preview.mjs's contract for the same field. -->
    <h1 class="stem" v-html="renderInlineMarkdown(current.stem)" />
    <ul class="options">
      <li
        v-for="option in current.options"
        :key="option.id"
        :class="revealed.has(option.id) ? (option.correct ? 'correct' : 'incorrect') : ''"
      >
        <button type="button" @click="selectOption(option.id)">
          <span class="option-text" v-html="renderInlineMarkdown(option.text)" />
        </button>
        <div v-if="revealed.has(option.id)" class="feedback">
          <p class="verdict">{{ option.correct ? "Correct" : "Incorrect" }}</p>
          <p class="explanation" v-html="renderInlineMarkdown(option.explanation)" />
        </div>
      </li>
    </ul>
    <MButton type="button" class="next" @click="next">
      {{ index + 1 === total ? "Finish" : "Next question" }}
    </MButton>

    <ReportModal v-if="isReporting" :question-id="current.id" @close="isReporting = false" />
  </main>
</template>

<style scoped>
.practice {
  max-width: 40rem;
  margin: 0 auto;
}

.practice h1 {
  font-size: 1.4rem;
  margin: 0.25rem 0 1rem;
}

.practice-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.5rem;
}

.progress {
  color: var(--surface-fg-muted);
  font-size: 0.85rem;
  margin: 0;
}

.options {
  list-style: none;
  padding: 0;
  margin: 0 0 1.5rem;
}

.options li {
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md, 8px);
  margin-bottom: 0.6rem;
  overflow: hidden;
}

.options li.correct {
  border-color: var(--status-ok);
  background: color-mix(in srgb, var(--status-ok) 12%, transparent);
}

.options li.incorrect {
  border-color: var(--status-bad);
  background: color-mix(in srgb, var(--status-bad) 12%, transparent);
}

.options button {
  display: block;
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  color: inherit;
  font: inherit;
  padding: 0.75rem 1rem;
  cursor: pointer;
}

.feedback {
  padding: 0 1rem 0.75rem;
}

.feedback .verdict {
  font-weight: 600;
  margin: 0 0 0.25rem;
}

.feedback .explanation {
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
  margin: 0;
}

.practice-summary .score {
  font-size: 1.2rem;
  font-weight: 600;
}

.practice-summary .meta,
.practice-empty p {
  color: var(--surface-fg-muted);
}
</style>
