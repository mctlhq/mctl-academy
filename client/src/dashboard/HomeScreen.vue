<script setup lang="ts">
import { computed, ref } from "vue";
import { MButton } from "@mctlhq/ui";
import DomainBar from "../components/DomainBar.vue";
import { calculateProgressStats, calculateStudyStreak } from "../services/progressStore";
import { questionsForCourse } from "../services/contentBundle";
import { domainTitlesFor } from "../services/courseCatalog";
import { useCourseStore } from "../services/courseStore";

defineProps<{
  onStartPractice: () => void;
  onReviewMistakes: () => void;
}>();

// Same course scope as the dashboard — see DashboardScreen.vue.
const { currentCourseId } = useCourseStore();
const stats = ref(
  calculateProgressStats(
    questionsForCourse(currentCourseId.value),
    undefined,
    domainTitlesFor(currentCourseId.value),
  ),
);
const streak = calculateStudyStreak();
const practiceLabel = computed(() => (stats.value.totalAttempted > 0 ? "Continue practice" : "Start practice"));
const practiceDescription = computed(() => {
  if (stats.value.totalAttempted === 0) return "Build your baseline with evidence-backed practice questions.";
  return `${stats.value.totalAttempted} of ${stats.value.totalBankQuestions} questions attempted.`;
});
</script>

<template>
  <section class="home-screen page-shell">
    <p class="section-marker">Recommended next step</p>
    <div class="next-card">
      <div>
        <h1>{{ practiceLabel }}</h1>
        <p>{{ practiceDescription }}</p>
      </div>
      <MButton type="button" @click="onStartPractice">{{ practiceLabel }} <span aria-hidden="true">→</span></MButton>
    </div>

    <div class="home-grid">
      <section aria-labelledby="domain-readiness-title">
        <h2 id="domain-readiness-title" class="section-heading">Domain readiness</h2>
        <div class="domain-bars">
          <DomainBar
            v-for="domain in stats.domainProgress"
            :key="domain.domainId"
            :label="domain.domainTitle"
            :value="domain.accuracy"
            :detail="`${domain.attemptedQuestions}/${domain.totalQuestions}`"
          />
        </div>
      </section>

      <aside class="home-summary" aria-label="Learning summary">
        <dl class="stat-list">
          <div>
            <dt>Accuracy</dt>
            <dd>{{ stats.overallAccuracy }}%</dd>
          </div>
          <div>
            <dt>Attempted</dt>
            <dd>{{ stats.totalAttempted }}/{{ stats.totalBankQuestions }}</dd>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>{{ streak }} {{ streak === 1 ? "day" : "days" }}</dd>
          </div>
        </dl>

        <button
          v-if="stats.totalMistakes > 0"
          type="button"
          class="mistakes-callout"
          @click="onReviewMistakes"
        >
          <span>{{ stats.totalMistakes }} mistakes ready for review</span>
          <strong>Review now <span aria-hidden="true">→</span></strong>
        </button>
        <div v-else class="mistakes-callout mistakes-callout-clear">
          <span>No mistakes waiting for review.</span>
          <strong>Keep going</strong>
        </div>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.section-marker,
.section-heading,
.stat-list dt {
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.section-marker {
  margin: 0 0 0.75rem;
  color: var(--accent);
}

.next-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.75rem 2rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-lg);
  background: var(--surface-elevated);
}

.next-card h1 {
  margin: 0 0 0.35rem;
  font-size: clamp(1.25rem, 2vw, 1.55rem);
}

.next-card p {
  margin: 0;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.78rem;
}

.home-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 18.75rem;
  gap: 3rem;
  margin-top: 2.25rem;
}

.section-heading {
  margin: 0 0 1.25rem;
  color: var(--surface-fg-subtle);
}

.domain-bars {
  display: grid;
  gap: 1.1rem;
}

.home-summary {
  min-width: 0;
}

.stat-list {
  display: grid;
  gap: 1rem;
  margin: 0 0 1.25rem;
  padding: 0 0 1.25rem;
  border-bottom: 1px solid var(--surface-line);
}

.stat-list div {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.stat-list dt {
  color: var(--surface-fg-subtle);
}

.stat-list dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 1.1rem;
  font-weight: 600;
}

.mistakes-callout {
  display: grid;
  width: 100%;
  gap: 0.6rem;
  padding: 1rem 1.1rem;
  border: 1px solid var(--status-bad);
  border-radius: var(--mctl-radius-lg);
  background: color-mix(in srgb, var(--status-bad) 8%, transparent);
  color: var(--surface-fg);
  text-align: left;
  cursor: pointer;
}

.mistakes-callout strong {
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.75rem;
}

.mistakes-callout-clear {
  border-color: var(--status-ok);
  background: color-mix(in srgb, var(--status-ok) 8%, transparent);
  cursor: default;
}

.mistakes-callout-clear strong {
  color: var(--status-ok);
}

@media (max-width: 800px) {
  .next-card {
    align-items: stretch;
    flex-direction: column;
    padding: 1.5rem;
  }

  .home-grid {
    grid-template-columns: 1fr;
    gap: 2rem;
  }
}

@media (max-width: 560px) {
  .home-screen {
    margin-top: -0.75rem;
    margin-bottom: -0.75rem;
  }

  .section-marker {
    margin-bottom: 0.5rem;
  }

  .next-card {
    gap: 0.85rem;
    padding: 1rem;
  }

  .next-card h1 {
    margin-bottom: 0.2rem;
    font-size: 1.15rem;
  }

  .next-card p {
    font-size: 0.72rem;
  }

  .home-grid {
    gap: 1.25rem;
    margin-top: 1.25rem;
  }

  .section-heading {
    margin-bottom: 0.75rem;
  }

  .domain-bars {
    gap: 0.75rem;
  }

  .stat-list {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.75rem;
  }

  .stat-list div {
    display: grid;
    gap: 0.25rem;
  }

  .stat-list dd {
    font-size: 0.95rem;
  }

  .mistakes-callout {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
  }

  .mistakes-callout strong {
    white-space: nowrap;
  }
}

@media (max-width: 400px) {
  .home-screen {
    margin-top: -1rem;
    margin-bottom: -1rem;
  }

  .next-card {
    gap: 0.5rem;
    padding: 0.75rem;
  }

  .home-grid {
    gap: 0.75rem;
    margin-top: 0.75rem;
  }

  .section-heading {
    margin-bottom: 0.5rem;
  }

  .domain-bars {
    gap: 0.5rem;
  }

  .stat-list {
    grid-template-columns: repeat(3, auto);
    justify-content: space-between;
    column-gap: 0.5rem;
    margin-bottom: 0.5rem;
    padding-bottom: 0.5rem;
  }

  .mistakes-callout {
    padding: 0.625rem 0.75rem;
  }
}

@media (max-width: 340px) {
  .next-card,
  .home-grid {
    gap: 0.75rem;
  }

  .home-grid {
    margin-top: 1rem;
  }

  .domain-bars {
    gap: 0.6rem;
  }
}
</style>
