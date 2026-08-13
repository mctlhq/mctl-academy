<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, watch, type Ref } from "vue";
import { MButton } from "@mctlhq/ui";
import { usePracticeSession } from "./usePracticeSession";
import type { BundleQuestion } from "../services/contentBundle";
import RestrictedMarkdown from "../exam/components/RestrictedMarkdown.vue";
import ReportModal from "../components/ReportModal.vue";
import { castVote, fetchVoteSummary, removeVote, type VoteValue } from "../services/questionVotes";
import type { UserProfile } from "../types/user";

/**
 * Renders one practice session over the questions it is handed. The bundle is
 * always already scoped to the selected course by the routed view, which also
 * keys this component on the course id — so switching course remounts a fresh
 * session rather than mutating a running one.
 */
const props = withDefaults(
  defineProps<{
    bundle: readonly BundleQuestion[];
    title?: string;
    emptyMessage?: string;
  }>(),
  { title: "Practice" },
);

const { current, index, total, revealed, score, attempted, selectOption, next } = usePracticeSession(
  props.bundle,
);

const isReporting = ref(false);

// Vote widget: authenticated-only (hidden entirely for anonymous visitors,
// not just disabled — see App.vue's `provide("currentUser", user)`), and
// scoped to whichever question is current. `voteScore` is null while the
// summary for the current question hasn't resolved yet, so the widget never
// flashes a fabricated 0 before the real number loads.
const currentUser = inject<Ref<UserProfile | null>>("currentUser");
const voteScore = ref<number | null>(null);
const userVote = ref<-1 | 0 | 1>(0);
const voteErrored = ref(false);

// Shared by the summary GET and every vote mutation: guards against any
// out-of-order response landing over a newer one — a slow GET for question A
// resolving after `next()` moved on to question B, a summary fetch resolving
// after a vote click already updated the widget, or two rapid vote clicks
// resolving out of order. Only the response for the request that is still
// the latest on arrival is applied.
let voteRequestToken = 0;

async function loadVoteSummary(questionId: string) {
  const token = ++voteRequestToken;
  voteErrored.value = false;
  try {
    const summary = await fetchVoteSummary(questionId);
    if (token !== voteRequestToken) return;
    voteScore.value = summary.score;
    userVote.value = summary.userValue;
  } catch {
    if (token !== voteRequestToken) return;
    voteScore.value = null;
    userVote.value = 0;
    voteErrored.value = true;
  }
}

watch(
  [() => current.value?.id, currentUser ?? ref(null)],
  ([questionId, user]) => {
    voteRequestToken += 1; // invalidate any in-flight request for a prior question
    voteScore.value = null;
    userVote.value = 0;
    voteErrored.value = false;
    if (questionId && user) {
      loadVoteSummary(questionId);
    }
  },
  { immediate: true },
);

/**
 * Optimistic vote toggle: clicking the same direction again removes the
 * vote (symmetric +1/-1 toggle behaviour), clicking the other direction
 * switches it. The local score/active-state update immediately; a failed
 * request rolls back to the last known-good summary from the server rather
 * than leaving an optimistic value that never actually landed.
 */
async function onVoteClick(direction: VoteValue) {
  const questionId = current.value?.id;
  if (!questionId || !currentUser?.value) return;

  const previousScore = voteScore.value;
  const previousUserVote = userVote.value;
  const removing = previousUserVote === direction;

  const nextUserVote = removing ? 0 : direction;
  voteScore.value = (previousScore ?? 0) - previousUserVote + nextUserVote;
  userVote.value = nextUserVote;
  voteErrored.value = false;

  // Shares voteRequestToken with loadVoteSummary: bumping it here invalidates
  // any in-flight summary GET (or an earlier vote click) so a slower, older
  // response can never land after this action and overwrite it.
  const token = ++voteRequestToken;

  try {
    const summary = removing ? await removeVote(questionId) : await castVote(questionId, direction);
    if (token !== voteRequestToken) return; // superseded by a newer request
    voteScore.value = summary.score;
    userVote.value = summary.userValue;
  } catch {
    if (token !== voteRequestToken) return;
    voteScore.value = previousScore;
    userVote.value = previousUserVote;
    voteErrored.value = true;
  }
}

const CONTEXT_STORAGE_KEY = "academy.practice-context-open";
const contextOpen = ref(
  typeof localStorage !== "undefined" && localStorage.getItem(CONTEXT_STORAGE_KEY) === "true",
);
const progressPercent = computed(() =>
  total.value === 0 ? 0 : Math.round(((index.value + 1) / total.value) * 100),
);

function toggleContext() {
  contextOpen.value = !contextOpen.value;
  localStorage.setItem(CONTEXT_STORAGE_KEY, String(contextOpen.value));
}

function handleShortcut(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target?.matches("input, textarea, select, button, a")) return;
  if (/^[1-4]$/.test(event.key) && current.value) {
    const option = current.value.options[Number(event.key) - 1];
    if (option) selectOption(option.id);
  }
  if (event.key.toLowerCase() === "n") next();
}

onMounted(() => window.addEventListener("keydown", handleShortcut));
onUnmounted(() => window.removeEventListener("keydown", handleShortcut));

// Single stable live region for screen-reader feedback announcements.
// Updated with the most recent Correct/Incorrect verdict only — never accumulates
// past answers, and cleared when advancing to the next question so repeated
// selections of the same option do not trigger duplicate announcements.
const lastAnnouncement = ref("");

let prevRevealed = new Set<string>();
let prevQuestionId: string | undefined;
watch([revealed, () => current.value?.id], ([nextRevealed, questionId]) => {
  if (!current.value) {
    lastAnnouncement.value = "";
    prevRevealed = new Set();
    prevQuestionId = undefined;
    return;
  }
  if (questionId !== prevQuestionId) {
    lastAnnouncement.value = "";
    prevRevealed = new Set();
    prevQuestionId = questionId;
  }
  const newlyRevealed = [...nextRevealed].filter((id) => !prevRevealed.has(id));
  prevRevealed = new Set(nextRevealed);
  if (newlyRevealed.length > 0) {
    const lastOption = current.value.options.find((o) => o.id === newlyRevealed[newlyRevealed.length - 1]);
    if (lastOption) {
      lastAnnouncement.value = lastOption.correct ? "Correct" : "Incorrect";
    }
  }
});
</script>

<template>
  <section v-if="total === 0" class="practice practice-empty">
    <h1>{{ title }}</h1>
    <p v-if="emptyMessage">{{ emptyMessage }}</p>
    <p v-else>
      There are no published questions yet. Check back once the content bank has questions with
      <code>status: published</code>.
    </p>
  </section>

  <section v-else-if="!current" class="practice practice-summary">
    <h1>Session complete</h1>
    <p class="score">{{ score }} / {{ attempted }} correct on first try</p>
    <p class="meta">{{ total }} questions attempted this session.</p>
  </section>

  <section v-else class="practice-shell" :class="{ 'context-open': contextOpen }">
    <div class="practice-stage">
      <div class="practice">
        <div class="practice-header">
          <p class="progress">Question {{ index + 1 }} of {{ total }} · {{ current.objective }}</p>
          <div class="header-actions">
            <div v-if="currentUser" class="vote-widget" role="group" aria-label="Vote on this question">
              <button
                type="button"
                class="vote-button vote-down"
                :class="{ active: userVote === -1 }"
                :aria-pressed="userVote === -1"
                aria-label="Downvote this question"
                @click="onVoteClick(-1)"
              >
                <span class="vote-icon" aria-hidden="true">▼</span>
              </button>
              <span class="vote-score" :class="{ 'vote-score-error': voteErrored }">
                {{ voteScore === null ? "\u00b7\u00b7" : voteScore }}
              </span>
              <button
                type="button"
                class="vote-button vote-up"
                :class="{ active: userVote === 1 }"
                :aria-pressed="userVote === 1"
                aria-label="Upvote this question"
                @click="onVoteClick(1)"
              >
                <span class="vote-icon" aria-hidden="true">▲</span>
              </button>
            </div>
            <button type="button" class="report-button" @click="isReporting = true">Report question</button>
          </div>
        </div>

        <h1 class="stem"><RestrictedMarkdown :text="current.stem" /></h1>
        <ul :key="current.id" class="options">
          <li
            v-for="option in current.options"
            :key="option.id"
            :class="revealed.has(option.id) ? (option.correct ? 'correct' : 'incorrect') : ''"
          >
            <button type="button" @click="selectOption(option.id)">
              <span class="option-text"><RestrictedMarkdown :text="option.text" /></span>
            </button>
            <div v-if="revealed.has(option.id)" class="feedback">
              <p class="verdict">{{ option.correct ? "Correct" : "Incorrect" }}</p>
              <p class="explanation"><RestrictedMarkdown :text="option.explanation" /></p>
            </div>
          </li>
        </ul>
        <div class="practice-actions">
          <MButton type="button" class="next" @click="next">
            {{ index + 1 === total ? "Finish" : "Next question" }}
          </MButton>
        </div>
        <p class="sr-only" aria-live="polite" aria-atomic="true">{{ lastAnnouncement }}</p>
      </div>

      <aside class="practice-context" :aria-hidden="!contextOpen">
        <button
          type="button"
          class="context-toggle"
          :aria-expanded="contextOpen"
          aria-label="Toggle practice context"
          @click="toggleContext"
        >
          <span aria-hidden="true">{{ contextOpen ? "›" : "i" }}</span>
        </button>
        <div v-if="contextOpen" class="context-content">
          <section>
            <h2>Session</h2>
            <div class="context-progress"><span :style="{ width: `${progressPercent}%` }" /></div>
            <p>{{ index + 1 }} of {{ total }} questions</p>
          </section>
          <section>
            <h2>Objective</h2>
            <p>{{ current.objective }}</p>
          </section>
          <section>
            <h2>Shortcuts</h2>
            <p><kbd>1–4</kbd> select<br /><kbd>N</kbd> next</p>
          </section>
        </div>
      </aside>
    </div>

    <ReportModal v-if="isReporting" :question-id="current.id" @close="isReporting = false" />
  </section>
</template>

<style scoped>
.practice {
  width: min(100%, 43rem);
  margin: 0 auto;
}

.practice-shell {
  display: flex;
  width: min(100%, 80rem);
  min-height: 38rem;
  margin: -4rem auto;
  position: relative;
}

.practice-stage {
  display: grid;
  flex: 1;
  width: 100%;
  grid-template-columns: minmax(0, 1fr) 3rem;
  min-height: inherit;
}

.practice-shell.context-open .practice-stage {
  grid-template-columns: minmax(0, 1fr) 15rem;
}

.context-progress span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width var(--mctl-motion-duration-base) var(--mctl-motion-easing-standard);
}

.practice-stage > .practice {
  display: flex;
  flex-direction: column;
  padding: 3rem 2rem 4rem;
}

.practice h1 {
  font-size: clamp(1.3rem, 2.4vw, 1.55rem);
  line-height: 1.5;
  margin: 0 0 1.5rem;
  overflow-wrap: break-word;
}

.practice-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.progress {
  color: var(--surface-fg-muted);
  font-size: 0.85rem;
  font-family: var(--font-mono);
  margin: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.report-button {
  min-height: 2.75rem;
  padding: 0.5rem 0.25rem;
  border: 0;
  border-bottom: 1px solid currentColor;
  background: transparent;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  white-space: nowrap;
  cursor: pointer;
}

/* Un-boxed by design: it's a two-way toggle over one running count, not a
   distinct control that needs its own frame — every other in-line action at
   this scale (.report-button) is bare text/glyph with no border or fill, so
   a bordered pill here was the odd one out. .vote-button keeps its 44px
   touch target (WCAG 2.5.5) but paints nothing of its own; .vote-icon is
   the small glyph that actually carries color, and "active" is communicated
   the same way .report-button and nav links already do it in this app —
   with color and weight, not a filled shape. */
.vote-widget {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
}

.vote-button {
  display: inline-grid;
  min-width: 2.75rem;
  min-height: 2.75rem;
  place-items: center;
  border: 0;
  background: transparent;
  cursor: pointer;
}

.vote-icon {
  display: grid;
  place-items: center;
  color: var(--surface-fg-subtle);
  font-size: 0.6rem;
  line-height: 1;
  transition: color var(--mctl-motion-duration-base) var(--mctl-motion-easing-standard);
}

.vote-button:hover .vote-icon {
  color: var(--surface-fg);
}

.vote-button.vote-up.active .vote-icon {
  color: var(--status-ok);
}

.vote-button.vote-down.active .vote-icon {
  color: var(--status-bad);
}

.vote-score {
  min-width: 1.1rem;
  overflow-wrap: break-word;
  text-align: center;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
}

.vote-score-error {
  color: var(--status-bad);
}

.options {
  list-style: none;
  padding: 0;
  margin: 0 0 1.5rem;
}

.options li {
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md, 8px);
  margin-bottom: 0.65rem;
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
  padding: 0.95rem 1.1rem;
  cursor: pointer;
  overflow-wrap: break-word;
}

.feedback {
  padding: 0 1.1rem 0.95rem;
}

.feedback .verdict {
  font-family: var(--font-mono);
  font-size: 0.74rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  margin: 0 0 0.3rem;
  text-transform: uppercase;
}

.correct .verdict {
  color: var(--status-ok);
}

.incorrect .verdict {
  color: var(--status-bad);
}

.feedback .explanation {
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
  margin: 0;
}

/* Sticky rather than plain in-flow: at >560px (the ≤560px "focused-practice"
   tier below already fixes this a different way, via a viewport-height card
   with an internally-scrolling `.options`), a short question's `.practice`
   box stretches to the shell's 38rem floor and `margin-top: auto` puts the
   button at a consistent spot near the bottom of that floor — but any
   question whose stem+options exceed 38rem (common at desktop's default
   padding/line-height: measured 660-720px against the 608px floor for
   typical 4-option questions) makes `.practice` grow past the floor instead,
   so the button ends up wherever that particular question's content happens
   to end. Sticking it to the viewport bottom (bounded by `.practice`'s own
   box, so it still scrolls away normally once the card ends) gives it one
   predictable on-screen position regardless of question length, matching
   the mobile tier's fixed action bar instead of drifting with content. */
.practice-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: auto;
  padding-top: 1rem;
  position: sticky;
  bottom: 0;
  background: var(--surface-bg);
}

.next::after {
  content: " →";
}

.practice-context {
  min-width: 0;
  position: relative;
  border-left: 1px solid var(--surface-line);
  background: var(--surface-elevated);
}

.context-toggle {
  display: grid;
  width: 100%;
  height: 3rem;
  padding: 0;
  place-items: center;
  border: 0;
  background: transparent;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  cursor: pointer;
}

.context-toggle:hover {
  color: var(--accent);
}

.context-content {
  display: grid;
  gap: 1.5rem;
  padding: 0.25rem 1.35rem 1.5rem;
}

.context-content h2 {
  margin: 0 0 0.45rem;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.context-content p {
  overflow-wrap: anywhere;
  margin: 0;
  color: var(--surface-fg-muted);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  line-height: 1.7;
}

.context-progress {
  height: 4px;
  margin-bottom: 0.45rem;
  overflow: hidden;
  border-radius: var(--mctl-radius-pill);
  background: var(--surface-card);
}

kbd {
  color: var(--surface-fg);
  font: inherit;
}

.practice-summary .score {
  font-size: 1.2rem;
  font-weight: 600;
}

.practice-summary .meta,
.practice-empty p {
  color: var(--surface-fg-muted);
}

/* .practice-shell's desktop -4rem margin-top pulls it up into .app-main's
   own top padding (clamp(2rem,5vw,4rem)) by design, but AppNav switches to
   its taller two-row stacked layout at <=980px (see app.css's breakpoint
   reference map) while app-main's padding-top only shrinks at <=680px --
   in between (e.g. 768px, padding-top ~2.4rem), -4rem overshoots the
   padding box and drags .practice-context up underneath the nav's second
   row, making .context-toggle unclickable. Match the <=680px tier's
   smaller pull here too so it never exceeds app-main's own padding-top
   for any width AppNav is stacked at (2rem is the minimum, well above
   1.75rem in this range). */
@media (max-width: 980px) {
  .practice-shell {
    margin-top: -1.75rem;
  }
}

@media (max-width: 680px) {
  .practice-shell {
    margin: -1.75rem auto -2rem;
  }

  .practice-stage,
  .practice-shell.context-open .practice-stage {
    grid-template-columns: minmax(0, 1fr);
  }

  .practice-stage > .practice {
    width: 100%;
    padding: 2rem 0 3.5rem;
  }

  .practice-context {
    position: fixed;
    right: calc(1rem + env(safe-area-inset-right));
    bottom: calc(1rem + env(safe-area-inset-bottom));
    z-index: var(--mctl-z-index-overlay);
    width: 2.75rem;
    border: 1px solid var(--surface-line-strong);
    border-radius: var(--mctl-radius-pill);
    box-shadow: var(--mctl-shadow-overlay);
  }

  .context-open .practice-context {
    width: min(17rem, calc(100vw - 2rem));
    border-radius: var(--mctl-radius-lg);
  }

  .context-toggle {
    height: 2.75rem;
  }

  .context-content {
    padding-bottom: 1.25rem;
  }

  .progress {
    max-width: 72%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .practice-header {
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  .header-actions {
    gap: 0.5rem;
  }
}

@media (max-width: 560px) {
  .practice-shell {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .practice-stage,
  .practice-shell.context-open .practice-stage {
    grid-template-rows: minmax(0, 1fr);
    height: auto;
    min-height: 0;
    overflow: hidden;
  }

  .practice-stage > .practice {
    box-sizing: border-box;
    height: 100%;
    max-height: 100%;
    min-height: 0;
    padding-top: 1rem;
    padding-bottom: 1rem;
    overflow: hidden;
  }

  .practice-header {
    margin-bottom: 0.5rem;
  }

  .practice h1 {
    margin-bottom: 0.75rem;
    font-size: 1.15rem;
    line-height: 1.3;
  }

  .options {
    flex: 1;
    min-height: 0;
    margin-bottom: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .options li {
    margin-bottom: 0.4rem;
  }

  .options button {
    padding: 0.65rem 0.75rem;
  }

  .practice-actions {
    /* This tier already pins the action bar via a viewport-height card with
       `.options` scrolling internally (see `.practice-stage > .practice`'s
       `overflow: hidden` above) — `position: sticky` from the base rule has
       no scrollable range to act within here, but reset it explicitly
       rather than rely on that. */
    position: static;
    flex: none;
    margin-right: -0.25rem;
    margin-left: -0.25rem;
    padding: 0.75rem 0.25rem max(0.25rem, env(safe-area-inset-bottom));
  }
}

@media (max-width: 400px) {
  .practice-stage > .practice {
    padding-bottom: 1.25rem;
  }
}
</style>
