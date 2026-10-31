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

async function load() {
  error.value = null;
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
}

onMounted(load);

/** Share of the mock taken by one domain, as a whole percentage. */
function share(config: MockConfig, mockQuestions: number): number {
  return config.questionCount > 0 ? Math.round((mockQuestions / config.questionCount) * 100) : 0;
}

function handleStart() {
  if (loaded.value && loaded.value.selection.ok) {
    emit("start", loaded.value.selection.questions, loaded.value.config.timeLimitMinutes);
  }
}
</script>

<template>
  <section v-if="error" class="mock-start" data-testid="mock-start-error">
    <h1>Mock exam</h1>
    <p role="alert">{{ error }}</p>
    <MButton type="button" @click="load">Retry</MButton>
  </section>

  <section v-else-if="!loaded" class="mock-start" data-testid="mock-start-loading">
    <p role="status">Loading…</p>
  </section>

  <section v-else class="mock-start" data-testid="mock-start">
    <h1>Mock exam</h1>
    <p class="mock-start-lede">
      A timed, full-length simulation. No feedback is shown until you submit or time runs out.
      <span v-if="loaded.config.discloseBankSize" class="mock-start-bank">
        Drawn from a bank of <span data-testid="bank-size">{{ loaded.bankSize }} questions</span>.
      </span>
    </p>

    <template v-if="loaded.selection.ok">
      <dl class="mock-start-facts">
        <div>
          <dt>Questions</dt>
          <dd>{{ loaded.config.questionCount }}</dd>
        </div>
        <div>
          <dt>Time limit</dt>
          <dd>{{ loaded.config.timeLimitMinutes }} minutes</dd>
        </div>
      </dl>

      <div class="mock-start-cta">
        <MButton type="button" class="mock-start-button" @click="handleStart">Start mock exam</MButton>
        <p class="mock-start-resume">An exam in progress resumes in this browser tab.</p>
      </div>
    </template>
    <div v-else class="mock-start-shortfall" data-testid="not-enough-content" role="status">
      <h2>Full mock not available for this course yet</h2>
      <p>
        Some domains do not have enough published questions for a full mock. You can keep practising while the
        bank is reviewed and expanded.
      </p>
      <a href="/practice" class="mock-start-practice">Continue practice</a>
      <details>
        <summary>What is missing</summary>
        <ul>
          <li v-for="s in loaded.selection.shortfall" :key="s.domain">
            {{ loaded.config.domains.find((d) => d.id === s.domain)?.title ?? s.domain }}:
            {{ s.available }} available, {{ s.needed }} needed
          </li>
        </ul>
      </details>
    </div>

    <section class="mock-start-domains" aria-labelledby="mock-start-domains-title">
      <h2 id="mock-start-domains-title">Questions per domain</h2>
      <ul>
        <li v-for="domain in loaded.config.domains" :key="domain.id">
          <span class="domain-title">{{ domain.title }}</span>
          <span class="domain-count">
            {{ domain.mockQuestions }}
            <span class="domain-share">· {{ share(loaded.config, domain.mockQuestions) }}%</span>
          </span>
        </li>
      </ul>
    </section>

    <details class="mock-start-details">
      <summary>How the mock exam works</summary>
      <h2 class="mock-start-details-title">How the mock exam works</h2>
      <p>
        Answer, skip, revisit and change any of the {{ loaded.config.questionCount }} questions before you
        submit. Results and explanations appear only after submission or when time runs out.
      </p>
      <p v-if="loaded.config.discloseBankSize" class="mock-start-disclosure">
        A repeat mock exam may include questions you have already seen; it is not guaranteed to be entirely
        fresh.
      </p>
    </details>
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

.mock-start h2 {
  margin: 0 0 0.6rem;
  font-size: 1rem;
}

.mock-start-facts {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
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
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.mock-start-facts dd {
  margin: 0.35rem 0 0;
  font-family: var(--font-mono);
  font-size: 1.35rem;
  font-weight: 300;
}

.mock-start-cta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin: 1.25rem 0 2rem;
}

.mock-start-button::after {
  content: " →";
}

.mock-start-resume {
  margin: 0;
  color: var(--surface-fg-subtle);
  font-size: 0.85rem;
}

.mock-start-domains ul {
  margin: 0 0 1.75rem;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--surface-line);
}

.mock-start-domains li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--surface-line);
}

.domain-count {
  flex: none;
  font-family: var(--font-mono);
}

.domain-share {
  color: var(--surface-fg-subtle);
}

.mock-start-practice {
  display: inline-flex;
  min-height: 2.75rem;
  align-items: center;
  padding: 0 1rem;
  border-radius: var(--mctl-radius-md, 6px);
  background: var(--accent);
  color: var(--accent-fg);
  text-decoration: none;
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

.mock-start-details-title {
  display: block;
}

.mock-start-details p:last-child {
  margin-bottom: 0;
}

.mock-start-shortfall {
  margin: 1.25rem 0 2rem;
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

  .mock-start-details .mock-start-details-title {
    display: none;
  }

  .mock-start-details:not([open]) > :not(summary) {
    display: none;
  }

  .mock-start-facts {
    margin-top: 1rem;
  }

  .mock-start-facts > div {
    padding: 0.75rem 0.5rem;
  }

  .mock-start-facts dd {
    font-size: 0.9rem;
    line-height: 1.3;
  }
}
</style>
