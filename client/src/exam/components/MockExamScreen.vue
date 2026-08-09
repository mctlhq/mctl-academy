<script setup lang="ts">
/**
 * The in-progress exam screen. Deliberately renders only `id`/`text` from
 * each option -- never `correct` or `explanation` -- so deferred feedback
 * cannot leak through this component regardless of what the session object
 * carries (see requirements.md's "SHALL NOT reveal" acceptance criterion).
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { ExamSessionState } from "../session";
import { remainingMs, unansweredCount } from "../session";
import RestrictedMarkdown from "./RestrictedMarkdown.vue";
import { formatRemaining } from "./formatTime";

const props = defineProps<{ session: ExamSessionState }>();
const emit = defineEmits<{
  answer: [questionId: string, optionId: string];
  submit: [];
  timeExpired: [];
}>();

const currentIndex = ref(0);
const now = ref(Date.now());
const confirmingSubmit = ref(false);

let interval: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  interval = setInterval(() => {
    now.value = Date.now();
  }, 250);
});
onUnmounted(() => {
  clearInterval(interval);
});

const remaining = computed(() => remainingMs(props.session, now.value));

watch(remaining, () => {
  if (props.session.status === "in_progress" && remaining.value <= 0) {
    emit("timeExpired");
  }
});

const question = computed(() => props.session.questions[currentIndex.value]);
const selectedOptionId = computed(() => props.session.answers[question.value.id]);
const unanswered = computed(() => unansweredCount(props.session));

function goSubmit() {
  if (unanswered.value > 0 && !confirmingSubmit.value) {
    confirmingSubmit.value = true;
    return;
  }
  emit("submit");
}
</script>

<template>
  <section class="mock-exam" data-testid="mock-exam">
    <header class="mock-exam-header">
      <span class="mock-exam-timer" data-testid="timer" aria-live="polite">
        {{ formatRemaining(remaining) }}
      </span>
      <span>Question {{ currentIndex + 1 }} of {{ session.questions.length }}</span>
    </header>

    <nav class="mock-exam-nav" aria-label="Question navigator">
      <button
        v-for="(q, index) in session.questions"
        :key="q.id"
        type="button"
        class="mock-exam-nav-item"
        :class="{
          answered: session.answers[q.id] !== undefined,
          unanswered: session.answers[q.id] === undefined,
          current: index === currentIndex,
        }"
        :aria-current="index === currentIndex"
        :aria-label="`Question ${index + 1}${session.answers[q.id] !== undefined ? ', answered' : ', unanswered'}`"
        @click="currentIndex = index"
      >
        {{ index + 1 }}
      </button>
    </nav>

    <article class="mock-exam-question">
      <p class="mock-exam-stem">
        <RestrictedMarkdown :text="question.stem" />
      </p>
      <fieldset>
        <legend class="sr-only">Options</legend>
        <label v-for="option in question.options" :key="option.id" class="mock-exam-option">
          <input
            type="radio"
            :name="`question-${question.id}`"
            :value="option.id"
            :checked="selectedOptionId === option.id"
            @change="emit('answer', question.id, option.id)"
          />
          <RestrictedMarkdown :text="option.text" />
        </label>
      </fieldset>
    </article>

    <footer class="mock-exam-footer">
      <button
        type="button"
        :disabled="currentIndex === 0"
        @click="currentIndex = Math.max(0, currentIndex - 1)"
      >
        Previous
      </button>
      <button
        type="button"
        :disabled="currentIndex === session.questions.length - 1"
        @click="currentIndex = Math.min(session.questions.length - 1, currentIndex + 1)"
      >
        Next
      </button>
      <button type="button" @click="goSubmit">Submit exam</button>
    </footer>

    <div v-if="confirmingSubmit" class="mock-exam-confirm" role="alertdialog" data-testid="submit-confirm">
      <p>
        {{ unanswered }} question{{ unanswered === 1 ? " is" : "s are" }} still unanswered. Submit
        anyway?
      </p>
      <button type="button" @click="emit('submit')">Submit anyway</button>
      <button type="button" @click="confirmingSubmit = false">Keep going</button>
    </div>
  </section>
</template>

<style scoped>
/* Same reading width as PracticeContent.vue's `.practice` — Mock previously
   had no cap at all and stretched to the full .app-main width at desktop
   sizes (~942px at 1024px, ~1328px at 1440px), producing a sparse
   10-column navigator and very wide option rows. 43rem stays the binding
   constraint down to 768px too (page-padding leaves ~706.6px there, still
   more than 688px), so this is a no-op at narrower widths where the app
   already used the full available width. */
.mock-exam {
  width: min(100%, 43rem);
  margin: 0 auto;
}

.mock-exam-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
}

.mock-exam-timer {
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 1.1rem;
}

.mock-exam-nav {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 0.35rem;
  margin: 0.75rem 0 1.25rem;
}

.mock-exam-nav-item {
  min-height: 2.25rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-sm, 4px);
  background: var(--surface-card);
  color: var(--surface-fg);
  font-size: 0.8rem;
  padding: 0.35rem 0;
  cursor: pointer;
}

.mock-exam-nav-item.answered {
  background: color-mix(in srgb, var(--status-ok) 12%, transparent);
  border-color: var(--status-ok);
}

.mock-exam-nav-item.current {
  outline: 2px solid var(--surface-fg);
}

.mock-exam-option {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  padding: 0.5rem 0.25rem;
  min-height: 2.75rem;
  border-radius: var(--mctl-radius-md, 6px);
  overflow-wrap: break-word;
}

.mock-exam-stem {
  overflow-wrap: break-word;
}

.mock-exam-footer {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.mock-exam-footer button,
.mock-exam-confirm button {
  min-height: 2.75rem;
}

.mock-exam-confirm {
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md, 6px);
  padding: 0.75rem 1rem;
  margin-top: 1rem;
}

/* .mock-exam-nav-item's 44px floor needs to hold everywhere the app's own
   nav is in its touch-oriented stacked layout (<=980px, see app.css's
   breakpoint reference map), not just <=620px -- at 768px it was still the
   36px (2.25rem) desktop default. Kept as its own rule, separate from the
   <=620px column-count change below, since 10 columns are still fine at
   768px (verified: ~63.8px/column with the Practice-width-matching 43rem
   container). */
@media (max-width: 980px) {
  .mock-exam-nav-item {
    min-height: 2.75rem;
  }
}

@media (max-width: 620px) {
  .mock-exam-nav {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .mock-exam-footer {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mock-exam-footer button:last-child {
    grid-column: 1 / -1;
  }

  .mock-exam-confirm {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .mock-exam-confirm p {
    grid-column: 1 / -1;
  }
}
</style>
