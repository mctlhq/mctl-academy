<script setup lang="ts">
import { onMounted, ref } from "vue";
import { MButton } from "@mctlhq/ui";
import type { ExamDataSource } from "../dataSource";
import type { MockConfig, Question } from "../types";
import { selectMockQuestions, type SelectMockResult } from "../selectMockQuestions";

const props = defineProps<{ dataSource: ExamDataSource }>();
const emit = defineEmits<{
  start: [questions: Question[], timeLimitMinutes: number];
}>();

interface LoadedState {
  config: MockConfig;
  bankSize: number;
  selection: SelectMockResult;
}

const loaded = ref<LoadedState | null>(null);
const error = ref<string | null>(null);

onMounted(async () => {
  try {
    const [config, questions, bankSize] = await Promise.all([
      props.dataSource.getMockConfig(),
      props.dataSource.getQuestions(),
      props.dataSource.getBankSize(),
    ]);
    loaded.value = { config, bankSize, selection: selectMockQuestions(questions, config) };
  } catch {
    error.value = "Could not load the question bank.";
  }
});

function handleStart() {
  if (loaded.value && loaded.value.selection.ok) {
    emit("start", loaded.value.selection.questions, loaded.value.config.timeLimitMinutes);
  }
}
</script>

<template>
  <section v-if="error" class="mock-start" data-testid="mock-start-error">
    <p role="alert">{{ error }}</p>
  </section>

  <section v-else-if="!loaded" class="mock-start" data-testid="mock-start-loading">
    <p>Loading...</p>
  </section>

  <section v-else class="mock-start" data-testid="mock-start">
    <h1>Mock exam</h1>
    <p class="mock-start-lede">
      A timed, full-length simulation. No feedback is shown until you submit or time runs out.
    </p>
    <dl class="mock-start-facts">
      <div>
        <dt>Questions</dt>
        <dd>{{ loaded.config.questionCount }}</dd>
      </div>
      <div>
        <dt>Time limit</dt>
        <dd>{{ loaded.config.timeLimitMinutes }} minutes</dd>
      </div>
      <div v-if="loaded.config.discloseBankSize">
        <dt>Bank size</dt>
        <dd data-testid="bank-size">{{ loaded.bankSize }} questions</dd>
      </div>
    </dl>

    <p class="mock-start-weighting">
      Weighted {{ loaded.config.domains.map((domain) => domain.mockQuestions).join("/") }} across the four domains.
    </p>

    <details class="mock-start-details">
      <summary>How the mock exam works</summary>
      <p v-if="loaded.config.discloseBankSize" class="mock-start-disclosure">
        Questions are drawn from the current bank above. A repeat mock exam may include
        questions you have already seen -- it is not guaranteed to be entirely fresh.
      </p>

      <p>
        No feedback is shown while the exam is in progress. Answer, skip, revisit, and change
        any of the {{ loaded.config.questionCount }} questions freely before you submit; results
        and explanations appear only after submission or when time runs out.
      </p>
    </details>

    <MButton v-if="loaded.selection.ok" type="button" @click="handleStart">
      Start mock exam
    </MButton>
    <div v-else class="mock-start-shortfall" data-testid="not-enough-content" role="alert">
      <p>Not enough published questions to start a mock exam yet.</p>
      <ul>
        <li v-for="s in loaded.selection.shortfall" :key="s.domain">
          {{ s.domain }}: needs {{ s.needed }}, has {{ s.available }}
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.mock-start {
  width: min(100%, 40rem);
  margin: 0 auto;
}

.mock-start h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.55rem, 3vw, 1.85rem);
}

.mock-start-lede,
.mock-start-disclosure,
.mock-start > p {
  color: var(--surface-fg-muted);
}

.mock-start-facts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 1px;
  margin: 1.5rem 0 0.8rem;
  padding: 1px;
  overflow: hidden;
  border-radius: var(--mctl-radius-lg);
  background: var(--surface-line);
}

.mock-start-facts > div {
  min-width: 0;
  padding: 1.1rem 1.2rem;
  background: var(--surface-card);
}

.mock-start-facts dt {
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.mock-start-facts dd {
  margin: 0.35rem 0 0;
  font-family: var(--font-mono);
  font-size: 1.35rem;
  font-weight: 300;
}

.mock-start-weighting {
  margin: 0 0 1.5rem;
  color: var(--surface-fg-subtle) !important;
  font-family: var(--font-mono);
  font-size: 0.72rem;
}

.mock-start-details {
  margin: 0 0 1.25rem;
  color: var(--surface-fg-muted);
}

.mock-start-details summary {
  display: none;
  color: var(--surface-fg);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  cursor: pointer;
}

.mock-start-details:not([open]) > :not(summary) {
  display: block;
}

.mock-start-details p:last-child {
  margin-bottom: 0;
}

.mock-start-shortfall {
  border: 1px solid var(--surface-line);
  border-left-width: 3px;
  border-left-color: var(--status-bad);
  padding: 0.75rem 1rem;
  border-radius: var(--mctl-radius-md, 6px);
}

@media (max-width: 620px) {
  .mock-start-details summary {
    display: list-item;
  }

  .mock-start-details:not([open]) > :not(summary) {
    display: none;
  }

  .mock-start-facts {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 1rem;
  }

  .mock-start-facts > div {
    padding: 0.75rem 0.5rem;
  }

  .mock-start-facts dt {
    font-size: 0.58rem;
  }

  .mock-start-facts dd {
    font-size: 0.9rem;
    line-height: 1.3;
  }

  .mock-start-weighting {
    margin-bottom: 0.75rem;
  }
}
</style>
