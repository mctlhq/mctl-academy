<script setup lang="ts">
/**
 * The in-progress exam screen. Deliberately renders only `id`/`text` from
 * each option -- never `correct` or `explanation` -- so deferred feedback
 * cannot leak through this component regardless of what the session object
 * carries (see requirements.md's "SHALL NOT reveal" acceptance criterion).
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { MButton } from "@mctlhq/ui";
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
  // A picked question closes the phone navigator so the question is in view.
  navExpanded.value = false;
  if (focusStem) void nextTick(() => stemRef.value?.focus());
}

// Up to 620px the 30-button navigator collapses into a disclosure: on a
// phone it otherwise pushes the question below the fold. Wider screens keep
// it open with no summary. A closed <details> hides its content whatever CSS
// says, so the open state is driven from here, not from a media query alone.
const NARROW_QUERY = "(max-width: 620px)";
const narrowMedia =
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia(NARROW_QUERY) : null;
const narrow = ref(narrowMedia?.matches ?? false);
const navExpanded = ref(false);
const navOpen = computed(() => !narrow.value || navExpanded.value);
function onNarrowChange(e: MediaQueryListEvent) {
  narrow.value = e.matches;
}
function onNavToggle(e: Event) {
  if (narrow.value) navExpanded.value = (e.target as HTMLDetailsElement).open;
}
const now = ref(Date.now());
const confirmingSubmit = ref(false);

let interval: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  interval = setInterval(() => {
    now.value = Date.now();
  }, 250);
  narrowMedia?.addEventListener("change", onNarrowChange);
});
onUnmounted(() => {
  clearInterval(interval);
  narrowMedia?.removeEventListener("change", onNarrowChange);
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
    <h1 class="sr-only">Mock exam – question {{ currentIndex + 1 }} of {{ session.questions.length }}</h1>
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

    <details class="mock-exam-nav-panel" :open="navOpen" @toggle="onNavToggle">
      <summary class="mock-exam-nav-summary" data-testid="mock-nav-summary">
        Question {{ currentIndex + 1 }} of {{ session.questions.length }}
      </summary>
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
          <span v-if="session.answers[q.id] !== undefined" class="mock-exam-nav-check" aria-hidden="true"
            >✓</span
          >{{ index + 1 }}
        </button>
      </nav>
    </details>

    <article class="mock-exam-question">
      <p ref="stemRef" class="mock-exam-stem" tabindex="-1">
        <RestrictedMarkdown :text="question.stem" />
      </p>
      <fieldset class="mock-exam-options">
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
      <MButton
        variant="ghost"
        class="mock-exam-step"
        :disabled="currentIndex === 0"
        @click="goTo(currentIndex - 1)"
      >
        Previous
      </MButton>
      <MButton
        class="mock-exam-step mock-exam-next"
        :disabled="currentIndex === lastIndex"
        @click="goTo(currentIndex + 1)"
      >
        Next
      </MButton>
      <MButton variant="ghost" class="mock-exam-submit" @click="goSubmit">Submit exam</MButton>
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
        <MButton variant="ghost" class="mock-exam-return" @click="returnToFirstUnanswered">
          Return to first unanswered
        </MButton>
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
  font-size: var(--text-caption-size);
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

.mock-exam-nav-panel {
  margin: 0.75rem 0 1.25rem;
}

/* Wide screens show the navigator itself; the summary only exists for the
   phone disclosure (<=620px, below). */
.mock-exam-nav-summary {
  display: none;
}

.mock-exam-nav {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 0.35rem;
}

.mock-exam-nav-item {
  display: inline-flex;
  min-height: 2.25rem;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  padding: 0.35rem 0;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-sm, 4px);
  background: var(--surface-card);
  color: var(--surface-fg);
  font-family: var(--font-mono);
  font-size: var(--text-caption-size);
  cursor: pointer;
}

/* No feedback is shown until submission, so "answered" is a neutral state:
   a stronger fill and a check glyph, never the ok/correct status colour. */
.mock-exam-nav-item.answered {
  border-color: var(--surface-line-strong);
  background: var(--surface-elevated);
}

.mock-exam-nav-check {
  color: var(--surface-fg-muted);
}

/* The current question is marked by an accent border and weight, so it
   cannot be mistaken for the keyboard focus ring (an outline). */
.mock-exam-nav-item.current {
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px var(--accent);
  font-weight: 700;
}

/* Reset the browser-default fieldset frame: each option carries its own
   token border, so a second box around the group only adds noise. */
.mock-exam-options {
  margin: 0;
  padding: 0;
  border: 0;
  min-inline-size: 0;
}

.mock-exam-option {
  display: flex;
  gap: 0.6rem;
  align-items: baseline;
  padding: 0.5rem 0.75rem;
  min-height: 2.75rem;
  margin-bottom: 0.4rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md, 6px);
  overflow-wrap: break-word;
  cursor: pointer;
}

.mock-exam-option:hover {
  border-color: var(--surface-line-strong);
}

.mock-exam-option input {
  accent-color: var(--accent);
}

.mock-exam-option:has(input:checked) {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
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

.mock-exam-footer > *,
.mock-exam-return {
  min-height: 2.75rem;
  justify-content: center;
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
  /* The disclosure's summary carries the position on phones. */
  .mock-exam-header .mock-exam-position {
    display: none;
  }

  .mock-exam-nav-summary {
    display: flex;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.4rem;
    padding: 0 0.75rem;
    border: 1px solid var(--surface-line);
    border-radius: var(--mctl-radius-md, 6px);
    background: var(--surface-card);
    font-family: var(--font-mono);
    font-size: var(--text-caption-size);
    cursor: pointer;
    list-style: none;
  }

  .mock-exam-nav-summary::-webkit-details-marker {
    display: none;
  }

  /* display:flex drops the native disclosure triangle, so draw a chevron:
     it points down while closed and up once the grid is open. */
  .mock-exam-nav-summary::after {
    content: "";
    width: 0.45rem;
    height: 0.45rem;
    margin-left: auto;
    border-right: 1.5px solid var(--surface-fg-subtle);
    border-bottom: 1.5px solid var(--surface-fg-subtle);
    transform: translateY(-25%) rotate(45deg);
  }

  .mock-exam-nav-panel[open] .mock-exam-nav-summary::after {
    transform: translateY(25%) rotate(-135deg);
  }

  @media (prefers-reduced-motion: no-preference) {
    .mock-exam-nav-summary::after {
      transition: transform 150ms ease;
    }
  }

  .mock-exam-nav-panel[open] .mock-exam-nav {
    margin-top: 0.5rem;
  }

  .mock-exam-nav {
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .mock-exam-footer {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mock-exam-footer > :last-child {
    grid-column: 1 / -1;
    margin-left: 0;
  }
}
</style>
