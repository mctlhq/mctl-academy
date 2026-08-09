<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { ExamDataSource } from "../dataSource";
import type { Question } from "../types";
import type { ExamSessionState } from "../session";
import { answerQuestion, scoreSession, startSession, submitSession } from "../session";
import { shuffleOptions } from "../shuffleOptions";
import { clearSession, loadSession, saveSession } from "../persistence";
import { recordAttempt } from "../../services/progressStore";
import MockStartScreen from "./MockStartScreen.vue";
import MockExamScreen from "./MockExamScreen.vue";
import MockResultsScreen from "./MockResultsScreen.vue";

const props = defineProps<{ dataSource: ExamDataSource; courseId: string }>();

// Scoped to the course this flow was mounted for. MockView keys the routed
// view on the course id, so switching course mounts a fresh flow that reads
// and writes only its own course's stored session.
const session = ref<ExamSessionState | null>(loadSession(props.courseId));

async function scrollToTop() {
  await nextTick();
  window.scrollTo({ top: 0, behavior: "auto" });
}

function handleStart(questions: Question[], timeLimitMinutes: number) {
  const shuffled = questions.map((q) => shuffleOptions(q));
  const started = startSession(shuffled, timeLimitMinutes, Date.now());
  saveSession(props.courseId, started);
  session.value = started;
  void scrollToTop();
}

function handleAnswer(questionId: string, optionId: string) {
  if (!session.value) return;
  const updated = answerQuestion(session.value, questionId, optionId);
  saveSession(props.courseId, updated);
  session.value = updated;
}

function handleSubmit() {
  if (!session.value) return;
  const submitted = submitSession(session.value, Date.now());
  saveSession(props.courseId, submitted);
  session.value = submitted;
  void scrollToTop();

  // Feed submitted mock answers into the same per-question progress store
  // Practice mode writes to, so the Progress Dashboard and Review Mistakes
  // mode reflect Mock exam attempts too (requirements.md: "in Practice
  // mode or in a submitted Mock exam").
  const { perQuestion } = scoreSession(submitted);
  for (const scored of perQuestion) {
    const question = submitted.questions.find((q) => q.id === scored.questionId);
    if (!question) continue;
    recordAttempt(scored.questionId, question.domain, scored.isCorrect);
  }
}

function handleStartOver() {
  clearSession(props.courseId);
  session.value = null;
  void scrollToTop();
}
</script>

<template>
  <MockStartScreen v-if="!session" :data-source="dataSource" @start="handleStart" />

  <MockExamScreen
    v-else-if="session.status === 'in_progress'"
    :session="session"
    @answer="handleAnswer"
    @submit="handleSubmit"
    @time-expired="handleSubmit"
  />

  <template v-else>
    <MockResultsScreen :session="session" />
    <button type="button" class="mock-restart" @click="handleStartOver">Start a new mock exam</button>
  </template>
</template>

<style scoped>
/* .app-main is a flex column with the default align-items:stretch, so a
   plain <button> with no width of its own stretches to the full app-main
   width. MockResultsScreen.vue's `.mock-results` caps itself at 43rem, so
   without this the restart button would be a full-width bar underneath a
   centered, much narrower results column at desktop sizes. */
.mock-restart {
  align-self: center;
  width: min(100%, 43rem);
  margin-top: 1.5rem;
}
</style>
