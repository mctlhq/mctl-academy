<script setup lang="ts">
import { computed, inject, type Ref } from "vue";
import { RouterLink } from "vue-router";
import { MButton } from "@mctlhq/ui";
import CourseGrid from "../components/CourseGrid.vue";
import { calculateProgressStats } from "../services/progressStore";
import { allQuestions, questionsForCourse } from "../services/contentBundle";
import { courseCatalog, domainTitlesFor, findCourse } from "../services/courseCatalog";
import { useCourseStore } from "../services/courseStore";

// The home page is the front door to every course, not the dashboard of
// whichever course happens to be selected: a first-time visitor sees what the
// academy offers before being pushed into one bank. Per-course progress lives
// on /dashboard; here it shrinks to one "continue" strip, shown only once the
// learner has answered something in the selected course.
//
// LEGAL.md: no certification name, vendor name, logo or colour on this page.
// The catalog fields used below are the vendor-neutral ones, and the
// certification wording stays generic ("the related certification exam").
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
const currentCourse = computed(() => findCourse(currentCourseId.value));
const showContinue = computed(() => Boolean(currentCourse.value?.available) && stats.value.totalAttempted > 0);

// The hero's primary action names the course it opens, so the header
// switcher and this page never disagree about where "Practice" leads.
const ctaCourse = computed(() =>
  currentCourse.value?.available ? currentCourse.value : courseCatalog.find((c) => c.available),
);
const ctaPath = computed(() =>
  ctaCourse.value ? `/practice?course=${encodeURIComponent(ctaCourse.value.id)}` : "/practice",
);

const availableCourses = computed(() => courseCatalog.filter((c) => c.available));
const upcomingCourses = computed(() => courseCatalog.filter((c) => !c.available));
const totalQuestions = computed(() =>
  availableCourses.value.reduce((sum, c) => sum + c.publishedQuestionCount, 0),
);

// Distinct documentation pages behind the published bank. Derived from the
// generated bundle, which only carries questions whose sources passed the
// build-time evidence gate, so the figure moves with the content.
const citedPages = computed(() => {
  const urls = new Set<string>();
  for (const q of allQuestions) for (const s of q.sources ?? []) urls.add(s.url);
  return urls.size;
});

const steps = [
  {
    title: "Practice one question at a time",
    body: "Your first answer counts. Every option comes with an explanation and a link to the documentation page it is drawn from.",
  },
  {
    title: "Review what you missed",
    body: "Wrong answers collect in a review queue, and progress is tracked per exam domain so you can see where to spend time.",
  },
  {
    title: "Take a timed mock exam",
    body: "When a course feels comfortable, sit a timed run that follows the course's domain weights.",
  },
];
</script>

<template>
  <section class="home-screen page-shell">
    <header class="home-hero">
      <p class="section-marker">Free · open source · no sign-up needed to start</p>
      <h1>Practice questions for AI cloud certifications, each one checked against its source.</h1>
      <p class="home-lead">
        Every question is written from public product documentation, reviewed independently, and cites the page
        that supports its answer. Pick a course, practice, review your mistakes, then try a timed mock exam.
      </p>

      <div class="home-cta">
        <MButton v-if="ctaCourse" :as="RouterLink" :to="ctaPath">
          {{ showContinue ? "Continue" : "Start practicing" }}: {{ ctaCourse.title }}
          <span aria-hidden="true">→</span>
        </MButton>
        <MButton as="a" href="#home-courses-title" variant="ghost">Browse all courses</MButton>
      </div>
      <p v-if="ctaCourse" class="home-cta-note">
        Practice, Mock exam and Mistakes in the header use the course selected there. Pick another course below or
        in the switcher at any time.
      </p>

      <dl class="home-facts" aria-label="Academy at a glance">
        <div>
          <dt>Courses available</dt>
          <dd>{{ availableCourses.length }}</dd>
        </div>
        <div>
          <dt>Published questions</dt>
          <dd>{{ totalQuestions }}</dd>
        </div>
        <div>
          <dt>Documentation pages cited</dt>
          <dd>{{ citedPages }}</dd>
        </div>
      </dl>

      <aside class="home-cert-note" aria-label="About certification">
        <p>
          <strong>Preparing for a certification exam?</strong>
          Each course follows the published domains of a related certification, so working through it may help you
          prepare. It does not reproduce the exam, does not predict a result, and is not a substitute for the
          vendor's own preparation material.
        </p>
      </aside>
    </header>

    <RouterLink v-if="showContinue && currentCourse" to="/practice" class="home-continue">
      <span class="home-continue-label">Continue where you left off</span>
      <span class="home-continue-course">{{ currentCourse.title }}</span>
      <span class="home-continue-detail">
        {{ stats.totalCorrect }} of {{ stats.totalBankQuestions }} solved · {{ stats.totalMistakes }} to review
      </span>
      <strong>Continue <span aria-hidden="true">→</span></strong>
    </RouterLink>

    <section class="home-courses" aria-labelledby="home-courses-title">
      <div class="home-section-head">
        <h2 id="home-courses-title" class="section-heading">Choose a course</h2>
        <MButton v-if="showContinue" :as="RouterLink" to="/dashboard" variant="ghost" size="sm">My progress</MButton>
      </div>
      <CourseGrid :courses="availableCourses" :current-course-id="currentCourseId" />
    </section>

    <section v-if="upcomingCourses.length" class="home-courses" aria-labelledby="home-upcoming-title">
      <h2 id="home-upcoming-title" class="section-heading">Coming soon</h2>
      <CourseGrid :courses="upcomingCourses" />
    </section>

    <section class="home-steps" aria-labelledby="home-steps-title">
      <h2 id="home-steps-title" class="section-heading">How it works</h2>
      <ol class="step-list">
        <li v-for="(step, i) in steps" :key="step.title">
          <span class="step-index" aria-hidden="true">{{ String(i + 1).padStart(2, "0") }}</span>
          <h3>{{ step.title }}</h3>
          <p>{{ step.body }}</p>
        </li>
      </ol>
    </section>
  </section>
</template>

<style scoped>
.section-marker,
.home-facts dt,
.home-continue-label,
.step-index {
  font-family: var(--font-mono);
  font-size: var(--text-caption-size);
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.section-marker {
  margin: 0 0 0.75rem;
  color: var(--surface-fg-subtle);
}

.home-hero {
  max-width: 62rem;
}

.home-hero h1 {
  margin: 0 0 0.9rem;
  font-size: clamp(1.5rem, 3.2vw, 2.35rem);
  line-height: 1.15;
  letter-spacing: -0.01em;
  text-wrap: balance;
}

.home-lead {
  max-width: 62ch;
  margin: 0;
  color: var(--surface-fg-muted);
  font-size: 1rem;
  line-height: 1.55;
}

.home-cta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.home-cta-note {
  max-width: 62ch;
  margin: 0.6rem 0 0;
  color: var(--surface-fg-subtle);
  font-size: var(--text-caption-size);
}

#home-courses-title {
  scroll-margin-top: 6rem;
}

.home-facts {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem 2.5rem;
  margin: 1.75rem 0 0;
}

.home-facts div {
  display: grid;
  gap: 0.2rem;
}

.home-facts dt {
  color: var(--surface-fg-subtle);
}

.home-facts dd {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 1.5rem;
  font-weight: 600;
}

.home-cert-note {
  max-width: 62ch;
  margin-top: 1.75rem;
  padding: 1rem 1.15rem;
  border-left: 3px solid var(--accent);
  border-radius: 0 var(--mctl-radius-lg) var(--mctl-radius-lg) 0;
  background: color-mix(in srgb, var(--accent) 7%, transparent);
}

.home-cert-note p {
  margin: 0;
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.home-cert-note strong {
  display: block;
  margin-bottom: 0.25rem;
  color: var(--surface-fg);
}

.home-continue {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas:
    "label label label"
    "course detail action";
  align-items: baseline;
  gap: 0.35rem 1.25rem;
  margin-top: 2.25rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--accent);
  border-radius: var(--mctl-radius-lg);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  color: var(--surface-fg);
  text-decoration: none;
}

.home-continue:hover,
.home-continue:focus-visible {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
}

.home-continue-label {
  grid-area: label;
  color: var(--surface-fg-subtle);
}

.home-continue-course {
  grid-area: course;
  font-weight: 600;
}

.home-continue-detail {
  grid-area: detail;
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
}

.home-continue strong {
  grid-area: action;
  color: var(--accent-text);
  font-family: var(--font-mono);
  font-size: var(--text-caption-size);
}

.home-courses {
  margin-top: 3rem;
}

.home-section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}

.home-steps {
  margin-top: 3.5rem;
}

.step-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.step-list li {
  padding-top: 1rem;
  border-top: 1px solid var(--surface-line);
}

.step-index {
  color: var(--accent-text);
}

.step-list h3 {
  margin: 0.4rem 0 0.35rem;
  font-size: 1rem;
  font-weight: 600;
}

.step-list p {
  margin: 0;
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

@media (max-width: 800px) {
  .step-list {
    grid-template-columns: 1fr;
    gap: 1rem;
  }

  .home-continue {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "label label"
      "course action"
      "detail detail";
  }
}

@media (max-width: 560px) {
  .home-facts {
    gap: 0.75rem 1.5rem;
    margin-top: 1.25rem;
  }

  .home-facts dd {
    font-size: 1.2rem;
  }

  .home-cert-note {
    margin-top: 1.25rem;
    padding: 0.85rem 1rem;
  }

  .home-courses {
    margin-top: 2rem;
  }

  .home-steps {
    margin-top: 2.5rem;
  }
}
</style>
