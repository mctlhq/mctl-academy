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

function handleNavigate(index: number) {
  if (!session.value || session.value.status !== "in_progress") return;
  const updated = { ...session.value, currentIndex: index };
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
    :initial-index="session.currentIndex ?? 0"
    @answer="handleAnswer"
    @navigate="handleNavigate"
    @submit="handleSubmit"
    @time-expired="handleSubmit"
  />

  <MockResultsScreen v-else :session="session" :course-id="courseId" @restart="handleStartOver" />
</template>
