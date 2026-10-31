<script setup lang="ts">
import { computed, inject, ref, type Ref } from "vue";
import { MButton } from "@mctlhq/ui";
import DomainBar from "../components/DomainBar.vue";
import ConfirmDialog from "../components/ConfirmDialog.vue";
import type { UserProfile } from "../types/user";
import { calculateProgressStats, clearProgress } from "../services/progressStore";
import { questionsForCourse } from "../services/contentBundle";
import { domainTitlesFor, findCourse } from "../services/courseCatalog";
import { useCourseStore } from "../services/courseStore";

defineProps<{
  onReviewMistakes: () => void;
  onStartPractice: (domain?: string) => void;
}>();

// Scoped to the selected course: the denominator, the attempts and the open
// mistakes all come from the same course's question bundle, so they can never
// describe different courses at once. App.vue remounts this view on a course
// change, so reading the id once here is enough.
const { currentCourseId } = useCourseStore();
const courseBundle = questionsForCourse(currentCourseId.value);
const domainTitles = domainTitlesFor(currentCourseId.value);

// A background syncFromServer() may merge in progress this device didn't
// have yet. It must refresh these stats without remounting the screen (an
// in-progress Practice session elsewhere in the app must survive it) — so
// this reads syncVersion reactively instead of App.vue keying on it.
const syncVersion = inject<Ref<number>>("syncVersion");
const clearedAt = ref(0);

const stats = computed(() => {
  void syncVersion?.value;
  void clearedAt.value;
  return calculateProgressStats(courseBundle, undefined, domainTitles);
});
const recommendedDomain = computed(() => {
  const weights = new Map(findCourse(currentCourseId.value)?.mock.domains.map((d) => [d.id, d.weight]));
  return (
    stats.value.domainProgress
      .filter((d) => d.correctQuestions < d.totalQuestions)
      .sort(
        (a, b) =>
          a.correctQuestions / a.totalQuestions - b.correctQuestions / b.totalQuestions ||
          (weights.get(b.domainId) ?? 0) - (weights.get(a.domainId) ?? 0) ||
          a.domainId.localeCompare(b.domainId),
      )[0] ?? null
  );
});

// The attempt log is shared by every course (progressStore.ts keeps one log
// and DELETE /api/attempts takes no course), so this control says so: it is
// labelled and confirmed as an all-courses erasure, not a reset of the
// course whose numbers sit above it.
const currentUser = inject<Ref<UserProfile | null>>("currentUser", ref(null));
const courseTitle = computed(() => findCourse(currentCourseId.value)?.title ?? "this course");
const confirmingClear = ref(false);
const clearPending = ref(false);
const clearOutcome = ref<"none" | "cleared" | "server-failed">("none");

function openClearConfirm() {
  confirmingClear.value = true;
}

async function handleClearHistory() {
  if (clearPending.value) return;
  clearPending.value = true;

  // clearProgress() clears localStorage synchronously before it ever awaits
  // anything — bumping clearedAt right after calling it (not after awaiting
  // the server round-trip) reflects that immediately, so a slow network
  // does not leave the screen showing stale numbers.
  const clearPromise = clearProgress();
  clearedAt.value += 1;

  const { serverCleared } = await clearPromise;
  clearPending.value = false;
  confirmingClear.value = false;
  // Local storage is already clear either way. When the server copy is not
  // confirmed deleted, the next sync would pull it straight back in — say so
  // rather than implying the deletion is permanent, and offer a retry.
  clearOutcome.value = serverCleared ? "cleared" : "server-failed";
}
</script>

<template>
  <section class="progress-screen page-shell">
    <div class="progress-grid">
      <div>
        <p class="section-marker section-marker-top">Questions solved</p>
        <div class="readiness-heading">
          <strong>{{ stats.solvedPercent }}%</strong>
          <span>{{
            stats.totalAttempted > 0
              ? `${stats.totalCorrect}/${stats.totalBankQuestions} questions solved correctly`
              : "Start practicing to solve your first question"
          }}</span>
        </div>
        <h1>Progress by domain</h1>
        <div class="domain-bars">
          <DomainBar
            v-for="domain in stats.domainProgress"
            :key="domain.domainId"
            :label="domain.domainTitle"
            :value="domain.solvedPercent"
            :detail="`${domain.correctQuestions}/${domain.totalQuestions} solved`"
            :to="`/practice?domain=${encodeURIComponent(domain.domainId)}`"
          />
        </div>
      </div>

      <aside class="progress-summary" aria-label="Progress details">
        <dl>
          <div>
            <dt>Not answered</dt>
            <dd>{{ stats.totalUnseen }}</dd>
          </div>
          <div>
            <dt>Solved</dt>
            <dd>{{ stats.totalCorrect }}</dd>
          </div>
          <div>
            <dt>Open mistakes</dt>
            <dd>{{ stats.totalMistakes }}</dd>
          </div>
        </dl>
        <p class="accuracy-detail">
          Accuracy on latest attempts:
          {{
            stats.totalAttempted
              ? `${stats.overallAccuracy}% (${stats.totalCorrect}/${stats.totalAttempted})`
              : "—"
          }}
        </p>
        <details class="metric-definitions">
          <summary>What these numbers mean</summary>
          <dl>
            <dt>Solved</dt>
            <dd>Your latest answer to the question is correct.</dd>
            <dt>Open mistakes</dt>
            <dd>Your latest answer to the question is wrong.</dd>
            <dt>Accuracy</dt>
            <dd>Solved questions as a share of the questions you have answered at least once.</dd>
          </dl>
        </details>
        <p class="accuracy-detail">Progress tracks this question bank, not exam readiness.</p>

        <div v-if="recommendedDomain" class="weakest-card">
          <span>Recommended next</span>
          <strong>{{ recommendedDomain.domainTitle }}</strong>
          <button type="button" @click="onStartPractice(recommendedDomain.domainId)">
            Continue practice <span aria-hidden="true">→</span>
          </button>
        </div>
        <MButton
          v-if="stats.totalMistakes > 0"
          type="button"
          variant="ghost"
          class="review-mistakes"
          @click="onReviewMistakes"
        >
          Review {{ stats.totalMistakes }} {{ stats.totalMistakes === 1 ? "mistake" : "mistakes" }}
        </MButton>
        <p v-if="stats.totalBankQuestions > 0 && stats.totalCorrect === stats.totalBankQuestions">
          All published questions solved. Open Practice to repeat the bank or take a mock exam.
        </p>
      </aside>
    </div>

    <section class="data-section" aria-labelledby="your-data-title">
      <h2 id="your-data-title">Your data</h2>
      <p>
        Your answer history is shared by every course. Clearing it resets progress and mistakes in all courses
        at once{{ currentUser ? ", on this device and on the server" : " on this device" }}.
      </p>
      <p v-if="clearOutcome === 'cleared'" class="data-status" role="status">
        History cleared for all courses.
      </p>
      <div v-else-if="clearOutcome === 'server-failed'" class="data-status data-status-bad" role="alert">
        <p>
          History was cleared on this device, but we could not confirm the server copy was deleted. It may
          reappear the next time your progress syncs.
        </p>
        <MButton type="button" variant="ghost" size="sm" :disabled="clearPending" @click="handleClearHistory">
          {{ clearPending ? "Retrying…" : "Retry server deletion" }}
        </MButton>
      </div>
      <MButton type="button" variant="ghost" size="sm" class="reset-progress" @click="openClearConfirm">
        Clear history for all courses…
      </MButton>
    </section>

    <ConfirmDialog
      :open="confirmingClear"
      title="Clear history for all courses?"
      confirm-label="Clear all history"
      pending-label="Clearing…"
      danger
      :pending="clearPending"
      @confirm="handleClearHistory"
      @cancel="confirmingClear = false"
    >
      <p>
        This deletes your answers and mistake history in <strong>every course</strong>, not only
        {{ courseTitle }}.
      </p>
      <p v-if="currentUser">It also deletes the copy stored with your account on the server.</p>
      <p><strong>This cannot be undone.</strong></p>
    </ConfirmDialog>
  </section>
</template>

<style scoped>
.accuracy-detail {
  color: var(--surface-fg-muted);
  font-size: 0.8rem;
}
.progress-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18.75rem;
  gap: 3rem;
}

.readiness-heading {
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
}

.readiness-heading strong {
  font-family: var(--font-mono);
  font-size: clamp(3rem, 7vw, 4rem);
  font-weight: 300;
  line-height: 1;
}

.readiness-heading span {
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.section-marker,
.progress-summary dt,
.weakest-card > span {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.section-marker {
  margin: 0.6rem 0 2rem;
  color: var(--surface-fg-subtle);
}

.section-marker-top {
  margin: 0 0 0.5rem;
}

.readiness-heading {
  margin-bottom: 2rem;
}

.metric-definitions {
  margin: 0.75rem 0 0;
  color: var(--surface-fg-muted);
  font-size: 0.85rem;
}

.metric-definitions summary {
  cursor: pointer;
}

.metric-definitions dt {
  margin-top: 0.5rem;
  color: var(--surface-fg);
  font-weight: 600;
}

.metric-definitions dd {
  margin: 0;
}

.review-mistakes {
  margin-top: 0.75rem;
}

.progress-screen h1 {
  margin: 0 0 1.35rem;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.domain-bars {
  display: grid;
  gap: 1.1rem;
}

.progress-summary dl {
  display: grid;
  gap: 1rem;
  margin: 0 0 1.4rem;
  padding: 0 0 1.4rem;
  border-bottom: 1px solid var(--surface-line);
}

.progress-summary dl div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.progress-summary dt {
  color: var(--surface-fg-subtle);
}

.progress-summary dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 1.1rem;
  font-weight: 600;
}

.weakest-card {
  display: grid;
  gap: 0.6rem;
  padding: 1rem 1.1rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-lg);
  background: var(--surface-elevated);
}

.weakest-card > span {
  color: var(--surface-fg-subtle);
}

.weakest-card strong {
  font-size: 0.9rem;
}

.weakest-card button {
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.data-section {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--surface-line);
  max-width: 43rem;
}

.data-section h2 {
  margin: 0 0 0.5rem;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.data-section p {
  margin: 0 0 0.75rem;
  color: var(--surface-fg-muted);
  font-size: 0.875rem;
}

.data-status {
  margin-bottom: 0.75rem;
}

.data-status-bad {
  padding: 0.75rem 1rem;
  border: 1px solid var(--status-bad);
  border-radius: var(--mctl-radius-md);
}

.reset-progress {
  color: var(--surface-fg-muted) !important;
}

.reset-progress:hover {
  border-color: var(--status-bad) !important;
  color: var(--status-bad) !important;
}

@media (max-width: 800px) {
  .progress-grid {
    grid-template-columns: 1fr;
    gap: 2.5rem;
  }
}

@media (max-width: 560px) {
  .progress-grid {
    gap: 0.75rem;
  }

  .readiness-heading {
    gap: 0.75rem;
  }

  .readiness-heading strong {
    font-size: 2.5rem;
  }

  .section-marker {
    margin: 0.4rem 0 0.75rem;
  }

  .progress-screen h1 {
    margin-bottom: 0.75rem;
  }

  .domain-bars {
    gap: 0.5rem;
  }

  .progress-summary dl {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
  }

  .progress-summary dl div {
    display: grid;
    gap: 0.25rem;
  }

  .progress-summary dd {
    font-size: 0.95rem;
  }

  .weakest-card {
    gap: 0.25rem;
    padding: 0.625rem;
  }

  .data-section {
    margin-top: 1.5rem;
  }
}
</style>
