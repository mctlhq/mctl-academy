<script setup lang="ts">
import { computed, inject, type Ref } from "vue";
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

// Same course scope as the dashboard — see DashboardScreen.vue. syncVersion
// is injected (not part of App.vue's remount key) so a background sync
// completing while the learner is elsewhere in the app refreshes this
// screen's numbers without destroying anyone's in-progress session.
const { currentCourseId } = useCourseStore();
const syncVersion = inject<Ref<number>>("syncVersion");
const stats = computed(() => {
  void syncVersion?.value;
  return calculateProgressStats(
    questionsForCourse(currentCourseId.value),
    undefined,
    domainTitlesFor(currentCourseId.value),
  );
});
const streak = computed(() => {
  void syncVersion?.value;
  return calculateStudyStreak();
});
const practiceLabel = computed(() =>
  stats.value.totalBankQuestions > 0 && stats.value.totalCorrect === stats.value.totalBankQuestions
    ? "All questions solved"
    : stats.value.totalAttempted > 0
      ? "Continue practice"
      : "Start practice",
);
const practiceDescription = computed(() => {
  if (stats.value.totalAttempted === 0) return "Build your baseline with evidence-backed practice questions.";
  return `${stats.value.totalCorrect} of ${stats.value.totalBankQuestions} questions solved. ${stats.value.totalUnseen} not answered; ${stats.value.totalMistakes} to review.`;
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
      <MButton type="button" @click="onStartPractice"
        >{{ practiceLabel }} <span aria-hidden="true">→</span></MButton
      >
    </div>

    <div class="home-grid">
      <section aria-labelledby="domain-readiness-title">
        <h2 id="domain-readiness-title" class="section-heading">Progress by domain</h2>
        <div class="domain-bars">
          <DomainBar
            v-for="domain in stats.domainProgress"
            :key="domain.domainId"
            :label="domain.domainTitle"
            :value="domain.solvedPercent"
            :detail="`${domain.correctQuestions}/${domain.totalQuestions} solved`"
          />
        </div>
      </section>

      <aside class="home-summary" aria-label="Learning summary">
        <dl class="stat-list">
          <div>
            <dt>Questions solved</dt>
            <dd>{{ stats.solvedPercent }}%</dd>
          </div>
          <div>
            <dt>Not answered</dt>
            <dd>{{ stats.totalUnseen }}</dd>
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

/* --accent is theme-selectable via the ui.mctl.ai CDN default (terracotta)
   and can be a loud color; spending it on a small
   uppercase caption reads as decoration, not signal, and every other
   ".section-marker" in the app (DashboardScreen.vue's "Overall readiness")
   uses --surface-fg-subtle instead. Matching that keeps this eyebrow
   consistent with its own name elsewhere in the app. */
.section-marker {
  margin: 0 0 0.75rem;
  color: var(--surface-fg-subtle);
}

/* Accent now frames the card itself instead of the caption above it —
   the same "semantic-color-tinted border + background" pattern already
   used one screen-section down by .mistakes-callout / .mistakes-callout-
   clear (status-bad/status-ok at the same 8% mix), just with --accent
   standing in for a status color since this card's role is "recommended
   action" rather than a pass/fail state. That gives the primary CTA the
   framing it needs without introducing a new visual language. */
.next-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.75rem 2rem;
  border: 1px solid var(--accent);
  border-radius: var(--mctl-radius-lg);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
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

/* This screen's own content rarely fills a desktop viewport tall enough for
   .app-main's sticky-footer flex layout to give it real leftover height
   (measured ~300px of blank space below the grid at 1440x900) — clamp()
   already lets .next-card h1 scale with viewport width, but everything else
   here was sized for the ~980px-and-below tier and just stays small at
   1440px+. Scaling body copy and the stat numbers up (still well inside the
   existing type scale — .stem/.next-card h1 already reach ~1.55rem) reads
   as more considered on a wide screen without adding new layout. */
@media (min-width: 981px) {
  .next-card {
    padding: 2rem 2.25rem;
  }

  .next-card p {
    font-size: 0.92rem;
  }

  .stat-list dd {
    font-size: 1.3rem;
  }

  .home-grid {
    gap: 3.5rem;
  }
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
