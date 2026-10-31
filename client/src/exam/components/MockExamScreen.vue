<script setup lang="ts">
/**
 * The in-progress exam screen. Deliberately renders only `id`/`text` from
 * each option -- never `correct` or `explanation` -- so deferred feedback
 * cannot leak through this component regardless of what the session object
 * carries (see requirements.md's "SHALL NOT reveal" acceptance criterion).
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import ConfirmDialog from "../../components/ConfirmDialog.vue";
import type { ExamSessionState } from "../session";
import { remainingMs, unansweredCount } from "../session";
import RestrictedMarkdown from "./RestrictedMarkdown.vue";
import { formatRemaining } from "./formatTime";

const props = defineProps<{ session: ExamSessionState; initialIndex?: number }>();
const emit = defineEmits<{
  answer: [questionId: string, optionId: string];
  submit: [];
  timeExpired: [];
  navigate: [index: number];
}>();

const lastIndex = computed(() => props.session.questions.length - 1);
const currentIndex = ref(Math.min(Math.max(props.initialIndex ?? 0, 0), Math.max(lastIndex.value, 0)));
const stemRef = ref<HTMLElement | null>(null);

// The position is reported up so a reload resumes on the same question, and
// focus moves to the new stem so screen-reader and keyboard users hear the
// question rather than staying on the control they pressed.
function goTo(index: number, focusStem = true) {
  currentIndex.value = Math.min(Math.max(index, 0), lastIndex.value);
  emit("navigate", currentIndex.value);
  if (focusStem) void nextTick(() => stemRef.value?.focus());
}
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

// The visible timer changes every second and must not be a live region (it
// would interrupt the learner constantly). A separate polite region speaks
// only when a milestone is crossed.
const MILESTONES_MINUTES = [10, 5, 1];
const timeAnnouncement = ref("");
watch(remaining, (now, before) => {
  if (before === undefined) return;
  for (const minutes of MILESTONES_MINUTES) {
    const mark = minutes * 60_000;
    if (before > mark && now <= mark) {
      timeAnnouncement.value = `${minutes} minute${minutes === 1 ? "" : "s"} remaining`;
    }
  }
});

const question = computed(() => props.session.questions[currentIndex.value]);
const selectedOptionId = computed(() => props.session.answers[question.value.id]);
const unanswered = computed(() => unansweredCount(props.session));
const answered = computed(() => props.session.questions.length - unanswered.value);

function goSubmit() {
  if (unanswered.value > 0) {
    confirmingSubmit.value = true;
    return;
  }
  emit("submit");
}

function returnToFirstUnanswered() {
  confirmingSubmit.value = false;
  const index = props.session.questions.findIndex((q) => props.session.answers[q.id] === undefined);
  if (index >= 0) goTo(index);
}
</script>

<template>
  <section class="mock-exam" data-testid="mock-exam">
    <header class="mock-exam-header">
      <span class="mock-exam-timer" data-testid="timer">
        <span class="sr-only">Time remaining: </span>{{ formatRemaining(remaining) }}
      </span>
      <span class="mock-exam-position"
        >Question {{ currentIndex + 1 }} of {{ session.questions.length }}</span
      >
      <span class="mock-exam-answered">{{ answered }} answered</span>
    </header>
    <p class="sr-only" aria-live="polite" aria-atomic="true">{{ timeAnnouncement }}</p>

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
        :aria-current="index === currentIndex ? 'step' : undefined"
        :aria-label="`Question ${index + 1}${session.answers[q.id] !== undefined ? ', answered' : ', unanswered'}`"
        @click="goTo(index)"
      >
        {{ index + 1 }}
      </button>
    </nav>

    <article class="mock-exam-question">
      <p ref="stemRef" class="mock-exam-stem" tabindex="-1">
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
        class="mock-exam-step"
        :disabled="currentIndex === 0"
        @click="goTo(currentIndex - 1)"
      >
        Previous
      </button>
      <button
        type="button"
        class="mock-exam-step mock-exam-next"
        :disabled="currentIndex === lastIndex"
        @click="goTo(currentIndex + 1)"
      >
        Next
      </button>
      <button type="button" class="mock-exam-submit" @click="goSubmit">Submit exam</button>
    </footer>

    <ConfirmDialog
      :open="confirmingSubmit"
      title="Submit the exam?"
      confirm-label="Submit anyway"
      cancel-label="Keep going"
      @confirm="emit('submit')"
      @cancel="confirmingSubmit = false"
    >
      <div data-testid="submit-confirm">
        <p>
          {{ answered }} of {{ session.questions.length }} answered; {{ unanswered }} question{{
            unanswered === 1 ? " is" : "s are"
          }}
          still unanswered and will count as incorrect.
        </p>
        <button type="button" class="mock-exam-return" @click="returnToFirstUnanswered">
          Return to first unanswered
        </button>
      </div>
    </ConfirmDialog>
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
  flex-wrap: wrap;
  gap: 0.25rem 1rem;
  align-items: baseline;
  padding: 0.5rem 0;
  font-family: var(--font-mono);
  font-size: 0.85rem;
}

.mock-exam-position {
  margin-right: auto;
}

.mock-exam-answered {
  color: var(--surface-fg-muted);
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
  outline: none;
}

.mock-exam-footer {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
}

.mock-exam-footer button,
.mock-exam-return {
  min-height: 2.75rem;
  padding: 0 1rem;
  border: 1px solid var(--surface-line-strong);
  border-radius: var(--mctl-radius-md, 6px);
  background: transparent;
  color: var(--surface-fg);
  font: inherit;
  cursor: pointer;
}

.mock-exam-footer button:disabled {
  opacity: 0.45;
  cursor: default;
}

.mock-exam-next {
  border-color: var(--accent);
  background: var(--accent);
  color: var(--accent-fg);
}

/* Submit is final, so it sits apart from the stepping controls and does not
   share Next's weight. */
.mock-exam-submit {
  margin-left: auto;
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
    margin-left: 0;
  }
}
</style>
