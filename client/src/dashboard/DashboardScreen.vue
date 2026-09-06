<script setup lang="ts">
import { computed, inject, ref, type Ref } from "vue";
import { MButton } from "@mctlhq/ui";
import DomainBar from "../components/DomainBar.vue";
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

async function handleClearHistory() {
  if (!window.confirm("Are you sure you want to clear your learning progress and mistake history?")) {
    return;
  }

  // clearProgress() clears localStorage synchronously before it ever awaits
  // anything — bumping clearedAt right after calling it (not after awaiting
  // the server round-trip) reflects that immediately, so a slow network
  // does not leave the screen showing stale numbers.
  const clearPromise = clearProgress();
  clearedAt.value += 1;

  const { serverCleared } = await clearPromise;
  if (!serverCleared) {
    // Local storage is already clear, but the server still holds the old
    // history — the next sync would otherwise pull it straight back in.
    // Say so rather than implying the deletion is permanent.
    window.alert(
      "Your local history was cleared, but we could not confirm the server copy was deleted. " +
        "It may reappear next time your progress syncs — please try again.",
    );
  }
}
</script>

<template>
  <section class="progress-screen page-shell">
    <div class="progress-grid">
      <div>
        <div class="readiness-heading">
          <strong>{{ stats.solvedPercent }}%</strong>
          <span>{{
            stats.totalAttempted > 0
              ? `${stats.totalCorrect}/${stats.totalBankQuestions} questions solved correctly`
              : "Start practicing to solve your first question"
          }}</span>
        </div>
        <p class="section-marker">Questions solved</p>

        <h1>Progress by domain</h1>
        <div class="domain-bars">
          <DomainBar
            v-for="domain in stats.domainProgress"
            :key="domain.domainId"
            :label="domain.domainTitle"
            :value="domain.solvedPercent"
            :detail="`${domain.correctQuestions}/${domain.totalQuestions} solved`"
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
        <p class="accuracy-detail">Progress tracks this question bank, not exam readiness.</p>

        <div v-if="recommendedDomain" class="weakest-card">
          <span>Recommended next</span>
          <strong>{{ recommendedDomain.domainTitle }}</strong>
          <button type="button" @click="onStartPractice(recommendedDomain.domainId)">
            Continue practice <span aria-hidden="true">→</span>
          </button>
        </div>
        <button v-if="stats.totalMistakes > 0" type="button" @click="onReviewMistakes">
          Review {{ stats.totalMistakes }} {{ stats.totalMistakes === 1 ? "mistake" : "mistakes" }}
        </button>
        <p v-if="stats.totalBankQuestions > 0 && stats.totalCorrect === stats.totalBankQuestions">
          All published questions solved. Open Practice to repeat the bank or take a mock exam.
        </p>

        <MButton type="button" variant="ghost" size="sm" class="reset-progress" @click="handleClearHistory">
          Reset progress history
        </MButton>
      </aside>
    </div>
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
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-marker {
  margin: 0.6rem 0 2rem;
  color: var(--surface-fg-subtle);
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

.reset-progress {
  margin-top: 1.25rem;
  color: var(--surface-fg-subtle) !important;
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

  .reset-progress {
    margin-top: 0.5rem;
  }
}
</style>
