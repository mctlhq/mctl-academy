<script setup lang="ts">
import { onMounted, ref } from "vue";
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
        <dt>Current question bank</dt>
        <dd data-testid="bank-size">{{ loaded.bankSize }} questions</dd>
      </div>
    </dl>

    <p v-if="loaded.config.discloseBankSize" class="mock-start-disclosure">
      Questions are drawn from the current bank above. A repeat mock exam may include
      questions you have already seen -- it is not guaranteed to be entirely fresh.
    </p>

    <p>
      No feedback is shown while the exam is in progress. Answer, skip, revisit, and change
      any of the {{ loaded.config.questionCount }} questions freely before you submit; results
      and explanations appear only after submission or when time runs out.
    </p>

    <button v-if="loaded.selection.ok" type="button" @click="handleStart">
      Start mock exam
    </button>
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
.mock-start-facts {
  display: flex;
  gap: 1.5rem;
  flex-wrap: wrap;
  padding: 1rem 0;
  border-top: 1px solid var(--surface-line);
  border-bottom: 1px solid var(--surface-line);
}

.mock-start-facts dt {
  font-size: 0.85rem;
  color: var(--surface-fg-muted);
}

.mock-start-facts dd {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.mock-start-shortfall {
  border: 1px solid var(--surface-line);
  border-left-width: 3px;
  border-left-color: var(--status-bad);
  padding: 0.75rem 1rem;
  border-radius: var(--mctl-radius-md, 6px);
}
</style>
