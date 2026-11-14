<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { RouterLink, useRoute } from "vue-router";
import { MButton, MPill } from "@mctlhq/ui";
import CourseGrid from "../components/CourseGrid.vue";
import { courseCatalog, findCourse, type CourseInfo } from "../services/courseCatalog";
import { useCourseStore } from "../services/courseStore";
import { questionsForCourse } from "../services/contentBundle";
import {
  COURSE_HEAD_TAGS,
  COURSE_JSONLD_ID,
  COURSE_NOT_FOUND_TITLE,
  courseHeadMeta,
  headTagSelector,
  type CourseHeadTagSpec,
} from "../seo/courseMeta.mjs";

const route = useRoute();
const { setCourse } = useCourseStore();

const courseId = computed(() => String(route.params.courseId ?? ""));
const course = computed<CourseInfo | undefined>(() => findCourse(courseId.value));
const questions = computed(() => (course.value ? questionsForCourse(course.value.id) : []));
const totalQuestions = computed(() => questions.value.length);

// Count questions per domain
function domainQuestionCount(domainId: string): number {
  return questions.value.filter((q) => q.domain === domainId).length;
}

// Other available tracks for internal SEO cross-linking
const otherCourses = computed(() => courseCatalog.filter((c) => c.available && c.id !== courseId.value));

// Practice and Mock links need no selection step of their own: an available
// course page has already made its course the selection on mount (below).
function domainPracticePath(domainId: string): string {
  return `/practice?domain=${encodeURIComponent(domainId)}`;
}

/**
 * Head tags are built by the module the server also renders course pages
 * with (server/spa.mjs), so a crawler without JavaScript and this view after
 * an in-app navigation produce identical strings.
 *
 * Restoring: a tag the server rewrote carries the site default in
 * `data-default`; otherwise the value found before this view's first write is
 * the default. Reading the live value alone would "restore" a server-rendered
 * course page's own canonical onto whatever page comes next.
 */
const savedDefaults = new Map<Element, string | null>();

function headTag(spec: CourseHeadTagSpec): Element | null {
  return typeof document === "undefined" ? null : document.querySelector(headTagSelector(spec));
}

function defaultFor(el: Element): string | null {
  return el.getAttribute("data-default") ?? savedDefaults.get(el) ?? null;
}

function restoreOriginalMeta() {
  if (typeof document === "undefined") return;
  for (const spec of COURSE_HEAD_TAGS) {
    const el = headTag(spec);
    if (!el || (!el.hasAttribute("data-default") && !savedDefaults.has(el))) continue;
    const original = defaultFor(el);
    if (original !== null) el.setAttribute(spec.attr, original);
    else el.removeAttribute(spec.attr);
  }
  document.getElementById(COURSE_JSONLD_ID)?.remove();
}

function updateMeta() {
  if (typeof document === "undefined") return;

  if (!course.value) {
    document.title = COURSE_NOT_FOUND_TITLE;
    restoreOriginalMeta();
    return;
  }

  const meta = courseHeadMeta(course.value);
  document.title = meta.title;
  if (!meta.jsonLd) {
    restoreOriginalMeta();
    return;
  }

  for (const spec of COURSE_HEAD_TAGS) {
    const el = headTag(spec);
    if (!el) continue;
    if (!el.hasAttribute("data-default") && !savedDefaults.has(el)) {
      savedDefaults.set(el, el.getAttribute(spec.attr));
    }
    el.setAttribute(spec.attr, meta[spec.field] ?? "");
  }

  let scriptEl = document.getElementById(COURSE_JSONLD_ID);
  if (!scriptEl) {
    scriptEl = document.createElement("script");
    scriptEl.id = COURSE_JSONLD_ID;
    scriptEl.setAttribute("type", "application/ld+json");
    document.head.appendChild(scriptEl);
  }
  scriptEl.textContent = JSON.stringify(meta.jsonLd);
}

// The header switcher shows the selected course, so a course page selects the
// course it shows; otherwise /courses/X rendered under another course's name in
// the header. Only available courses: a coming-soon or unknown id must never
// become the selection (setCourse refuses it anyway). This does not reintroduce
// the old switcher revert: the switcher navigates to /courses/<new id> when used
// on a course page, so the route and the selection always agree.
function syncSelectedCourse() {
  if (course.value?.available) setCourse(course.value.id);
}

onMounted(() => {
  syncSelectedCourse();
  updateMeta();
});

watch(course, () => {
  syncSelectedCourse();
  updateMeta();
});

onUnmounted(() => {
  restoreOriginalMeta();
});
</script>

<template>
  <div v-if="course && course.available" class="course-page page-shell" data-testid="course-page">
    <nav class="course-breadcrumbs" aria-label="Breadcrumb">
      <RouterLink to="/">Home</RouterLink>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{{ course.title }}</span>
    </nav>

    <header class="course-hero">
      <div class="course-badge-row">
        <MPill tone="accent">Practice track</MPill>
      </div>
      <h1 class="course-title">{{ course.title }}</h1>
      <p class="course-subtitle">
        Practice questions and domain syllabus for {{ course.title }}. Complete coverage with verified
        citations.
      </p>

      <div class="course-stats-bar" role="group" aria-label="Course statistics">
        <div class="course-stat">
          <span class="stat-value">{{ totalQuestions }}</span>
          <span class="stat-label">practice questions</span>
        </div>
        <div class="course-stat">
          <span class="stat-value">{{ course.mock.timeLimitMinutes }} min</span>
          <span class="stat-label">mock duration</span>
        </div>
        <div class="course-stat">
          <span class="stat-value">{{ course.mock.domains.length }}</span>
          <span class="stat-label">domains</span>
        </div>
      </div>

      <div class="course-cta-row">
        <MButton :as="RouterLink" to="/practice">
          Start practice ({{ totalQuestions }} questions) <span aria-hidden="true">→</span>
        </MButton>
        <MButton :as="RouterLink" to="/mock" variant="ghost">
          Timed mock run ({{ course.mock.questionCount }} questions)
        </MButton>
      </div>
    </header>

    <div class="course-content">
      <section class="course-domains" aria-labelledby="domains-heading">
        <h2 id="domains-heading" class="section-heading">Practice domains & syllabus</h2>
        <div class="domain-cards-list">
          <div v-for="domain in course.mock.domains" :key="domain.id" class="domain-card">
            <div class="domain-card-header">
              <span class="domain-card-tag">{{ domain.weight }}% domain weight</span>
              <span class="domain-card-count">{{ domainQuestionCount(domain.id) }} questions</span>
            </div>
            <h3 class="domain-card-title">{{ domain.title }}</h3>
            <p class="domain-card-mock">Mock distribution: {{ domain.mockQuestions }} questions</p>

            <div v-if="domain.objectives && domain.objectives.length > 0" class="domain-objectives">
              <h4 class="domain-objectives-heading">Skills & objectives:</h4>
              <ul class="domain-objectives-list">
                <li v-for="obj in domain.objectives" :key="obj.id" class="domain-objective-item">
                  {{ obj.title }}
                </li>
              </ul>
            </div>

            <div class="domain-card-action">
              <RouterLink
                :to="domainPracticePath(domain.id)"
                class="domain-btn-link"
                :aria-label="`Practice ${domain.title}`"
              >
                Practice this domain <span aria-hidden="true">→</span>
              </RouterLink>
            </div>
          </div>
        </div>
      </section>

      <!-- Exam structure & format section -->
      <section class="course-guide-section" aria-labelledby="format-heading">
        <h2 id="format-heading" class="section-heading">Exam structure & format</h2>
        <div class="guide-grid">
          <div class="guide-card">
            <h3 class="guide-card-title">Duration & question format</h3>
            <p class="guide-card-text">
              The assessment is a timed {{ course.mock.timeLimitMinutes }}-minute exam with {{ course.mock.questionCount }} scenario-based questions.
              Problems assess real production architecture, configuration choices, and operational troubleshooting rather than rote definitions.
            </p>
          </div>
          <div class="guide-card">
            <h3 class="guide-card-title">Curriculum domain weighting</h3>
            <p class="guide-card-text">
              Questions are drawn across {{ course.mock.domains.length }} distinct domains according to official curriculum weights.
              Our mock exam engine balances questions to match the exact percentage distribution required on test day.
            </p>
          </div>
          <div class="guide-card">
            <h3 class="guide-card-title">Grounded doc citations</h3>
            <p class="guide-card-text">
              Every practice item includes verified citations from public cloud documentation. Each distractor clearly explains why
              an alternative approach fails or degrades system performance.
            </p>
          </div>
        </div>
      </section>

      <!-- Preparation methodology section -->
      <section class="course-guide-section" aria-labelledby="strategy-heading">
        <h2 id="strategy-heading" class="section-heading">How to prepare for the certification</h2>
        <div class="strategy-steps">
          <div class="strategy-step">
            <span class="step-num">01</span>
            <div class="step-content">
              <h3 class="step-title">Domain-by-domain practice</h3>
              <p class="step-text">
                Start by drilling individual domains to identify knowledge gaps. Study the citation rationale for incorrect options
                to understand production constraints.
              </p>
            </div>
          </div>
          <div class="strategy-step">
            <span class="step-num">02</span>
            <div class="step-content">
              <h3 class="step-title">Timed mock exam runs</h3>
              <p class="step-text">
                Simulate the real exam experience with a full 60-minute, 30-question mock run. Manage your pace at approximately
                2 minutes per scenario.
              </p>
            </div>
          </div>
          <div class="strategy-step">
            <span class="step-num">03</span>
            <div class="step-content">
              <h3 class="step-title">Mistakes review queue</h3>
              <p class="step-text">
                Re-test questions you answered incorrectly. Solidify concepts until you achieve consistent mastery across all domains.
              </p>
            </div>
          </div>
        </div>
      </section>

      <!-- FAQ Section -->
      <section class="course-faq-section" aria-labelledby="faq-heading">
        <h2 id="faq-heading" class="section-heading">Frequently asked questions</h2>
        <div class="faq-list">
          <details class="faq-item">
            <summary class="faq-question">What skills are measured in the {{ course.title }} track?</summary>
            <div class="faq-answer">
              <p>
                The track evaluates practical competency across {{ course.mock.domains.length }} core domains:
                {{ course.mock.domains.map((d: any) => d.title).join(", ") }}.
                Candidates must demonstrate hands-on understanding of cloud infrastructure, security, monitoring, and workload deployment.
              </p>
            </div>
          </details>
          <details class="faq-item">
            <summary class="faq-question">Is this practice platform free to use?</summary>
            <div class="faq-answer">
              <p>
                Yes. mctl Academy is completely free and accessible without a paywall. You can take untimed practice tests or full timed mock exams at zero cost.
              </p>
            </div>
          </details>
          <details class="faq-item">
            <summary class="faq-question">Are questions identical to official certification questions?</summary>
            <div class="faq-answer">
              <p>
                No. In accordance with clean-room guidelines and our content policy, all items are original scenario problems authored from public documentation. They test the same technical objectives without reproducing proprietary exam content.
              </p>
            </div>
          </details>
        </div>
      </section>

      <section v-if="otherCourses.length > 0" class="other-courses" aria-labelledby="other-courses-heading">
        <h2 id="other-courses-heading" class="section-heading">Explore other courses</h2>
        <CourseGrid :courses="otherCourses" />
      </section>
    </div>
  </div>

  <div
    v-else-if="course && !course.available"
    class="course-coming-soon page-shell"
    data-testid="course-coming-soon"
  >
    <nav class="course-breadcrumbs" aria-label="Breadcrumb">
      <RouterLink to="/">Home</RouterLink>
      <span aria-hidden="true">/</span>
      <span aria-current="page">{{ course.title }}</span>
    </nav>

    <header class="course-hero">
      <div class="course-badge-row">
        <MPill tone="neutral">Upcoming track · Syllabus preview</MPill>
      </div>
      <p class="not-found-code">Coming soon</p>
      <h1 class="course-title">{{ course.title }}</h1>
      <p class="not-found-lede">
        Practice questions for this track are currently in preparation. Review the complete domain syllabus and exam objectives below.
      </p>

      <div class="course-stats-bar" role="group" aria-label="Course statistics">
        <div class="course-stat">
          <span class="stat-value">In review</span>
          <span class="stat-label">question bank</span>
        </div>
        <div class="course-stat">
          <span class="stat-value">{{ course.mock.timeLimitMinutes }} min</span>
          <span class="stat-label">mock duration</span>
        </div>
        <div class="course-stat">
          <span class="stat-value">{{ course.mock.domains.length }}</span>
          <span class="stat-label">domains</span>
        </div>
      </div>

      <div class="not-found-actions">
        <MButton :as="RouterLink" to="/practice">Continue practice</MButton>
        <MButton :as="RouterLink" to="/" variant="ghost">Go to home</MButton>
      </div>
    </header>

    <div class="course-content">
      <section class="course-domains" aria-labelledby="domains-heading-preview">
        <h2 id="domains-heading-preview" class="section-heading">Practice domains & syllabus</h2>
        <div class="domain-cards-list">
          <div v-for="domain in course.mock.domains" :key="domain.id" class="domain-card">
            <div class="domain-card-header">
              <span class="domain-card-tag">{{ domain.weight }}% domain weight</span>
              <span class="domain-card-count">{{ domain.mockQuestions }} questions</span>
            </div>
            <h3 class="domain-card-title">{{ domain.title }}</h3>
            <p class="domain-card-mock">Exam distribution: {{ domain.mockQuestions }} questions ({{ domain.weight }}%)</p>

            <div v-if="domain.objectives && domain.objectives.length > 0" class="domain-objectives">
              <h4 class="domain-objectives-heading">Skills & objectives:</h4>
              <ul class="domain-objectives-list">
                <li v-for="obj in domain.objectives" :key="obj.id" class="domain-objective-item">
                  {{ obj.title }}
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- Exam structure & format section -->
      <section class="course-guide-section" aria-labelledby="format-heading-preview">
        <h2 id="format-heading-preview" class="section-heading">Exam structure & preparation guide</h2>
        <div class="guide-grid">
          <div class="guide-card">
            <h3 class="guide-card-title">Duration & format</h3>
            <p class="guide-card-text">
              The {{ course.title }} examination is a 60-minute test consisting of 30 multiple-choice scenario questions evaluating practical cloud engineering, architecture, and operational decisions.
            </p>
          </div>
          <div class="guide-card">
            <h3 class="guide-card-title">Syllabus breakdown</h3>
            <p class="guide-card-text">
              The curriculum spans {{ course.mock.domains.length }} core domains shown above. Practice questions are being authored strictly from official documentation to provide verifiable citations for every answer.
            </p>
          </div>
          <div class="guide-card">
            <h3 class="guide-card-title">Full coverage in progress</h3>
            <p class="guide-card-text">
              Our automated content engine and independent reviewers are validating scenarios across all objectives to ensure high quality and zero trick questions.
            </p>
          </div>
        </div>
      </section>

      <section v-if="otherCourses.length > 0" class="other-courses" aria-labelledby="other-courses-heading-preview">
        <h2 id="other-courses-heading-preview" class="section-heading">Explore available courses</h2>
        <CourseGrid :courses="otherCourses" />
      </section>
    </div>
  </div>

  <div v-else class="course-not-found page-shell" data-testid="course-not-found">
    <p class="not-found-code">404</p>
    <h1>Course not found</h1>
    <p class="not-found-lede">The requested course could not be found or has been retired.</p>
    <div class="not-found-actions">
      <MButton :as="RouterLink" to="/">Go to home</MButton>
      <MButton :as="RouterLink" to="/practice" variant="ghost">Continue practice</MButton>
    </div>
  </div>
</template>

<style scoped>
.course-page,
.course-coming-soon,
.course-not-found {
  max-width: 60rem;
}

.course-breadcrumbs {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-caption-size);
}

.course-breadcrumbs a {
  color: var(--surface-fg-muted);
  text-decoration: none;
}

.course-breadcrumbs a:hover {
  color: var(--accent-text);
  text-decoration: underline;
}

.course-hero {
  padding: 2rem 2.25rem;
  border: 1px solid var(--accent);
  border-radius: var(--mctl-radius-lg);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  margin-bottom: 2.5rem;
}

.course-badge-row {
  margin-bottom: 0.5rem;
}

.course-title {
  margin: 0.35rem 0 0.75rem;
  font-size: clamp(1.4rem, 2.5vw, 2rem);
  line-height: 1.25;
}

.course-subtitle {
  margin: 0 0 1.5rem;
  color: var(--surface-fg-muted);
  font-size: 1rem;
  line-height: 1.5;
  max-width: 48rem;
}

.course-stats-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 2rem;
  margin-bottom: 1.75rem;
  padding: 1rem 0;
  border-top: 1px solid var(--surface-line);
  border-bottom: 1px solid var(--surface-line);
}

.course-stat {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.stat-value {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--surface-fg);
}

.stat-label {
  font-size: var(--text-caption-size);
  color: var(--surface-fg-subtle);
}

.course-cta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.course-domains {
  margin-bottom: 3rem;
}

.domain-cards-list {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1.25rem;
}

.domain-card {
  padding: 1.25rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md);
  background: var(--surface-card);
  display: flex;
  flex-direction: column;
}

.domain-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
  font-size: var(--text-caption-size);
}

.domain-card-tag {
  color: var(--accent-text);
  font-family: var(--font-mono);
  font-weight: 500;
}

.domain-card-count {
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
}

.domain-card-title {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  line-height: 1.35;
  color: var(--surface-fg);
  flex-grow: 1;
}

.domain-card-mock {
  margin: 0 0 0.75rem;
  font-size: var(--text-caption-size);
  color: var(--surface-fg-muted);
}

.domain-objectives {
  margin: 0.5rem 0 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--surface-line);
}

.domain-objectives-heading {
  margin: 0 0 0.5rem;
  font-size: var(--text-caption-size);
  font-family: var(--font-mono);
  color: var(--surface-fg-subtle);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.domain-objectives-list {
  margin: 0;
  padding-left: 1.15rem;
  color: var(--surface-fg-muted);
  font-size: 0.85rem;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.domain-card-action {
  margin-top: auto;
}

.domain-btn-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent-text);
  font-size: var(--text-caption-size);
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.domain-btn-link:hover,
.domain-btn-link:focus-visible {
  text-decoration: underline;
}

.course-guide-section {
  margin-bottom: 3rem;
}

.guide-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1.25rem;
}

.guide-card {
  padding: 1.25rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md);
  background: var(--surface-card);
}

.guide-card-title {
  margin: 0 0 0.5rem;
  font-size: 1.05rem;
  color: var(--surface-fg);
}

.guide-card-text {
  margin: 0;
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
  line-height: 1.5;
}

.strategy-steps {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1.25rem;
}

.strategy-step {
  display: flex;
  gap: 1rem;
  padding: 1.25rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md);
  background: var(--surface-card);
}

.step-num {
  font-family: var(--font-mono);
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--accent-text);
  opacity: 0.8;
}

.step-title {
  margin: 0 0 0.35rem;
  font-size: 1rem;
  color: var(--surface-fg);
}

.step-text {
  margin: 0;
  color: var(--surface-fg-muted);
  font-size: 0.88rem;
  line-height: 1.45;
}

.course-faq-section {
  margin-bottom: 3rem;
}

.faq-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.faq-item {
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md);
  background: var(--surface-card);
  padding: 0.85rem 1.25rem;
}

.faq-question {
  font-weight: 600;
  font-size: 0.98rem;
  color: var(--surface-fg);
  cursor: pointer;
  outline: none;
}

.faq-question:hover {
  color: var(--accent-text);
}

.faq-answer {
  margin-top: 0.65rem;
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.faq-answer p {
  margin: 0;
}

.other-courses {
  margin-bottom: 3rem;
}

.not-found-code {
  margin: 0 0 0.5rem;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-caption-size);
}

.not-found-lede {
  margin: 0 0 1.5rem;
  color: var(--surface-fg-muted);
}

.not-found-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}

@media (max-width: 800px) {
  .course-hero {
    padding: 1.5rem;
  }

  .course-stats-bar {
    gap: 1.25rem;
  }
}

@media (max-width: 560px) {
  .course-hero {
    padding: 1rem;
  }

  .course-title {
    font-size: 1.25rem;
  }

  .course-subtitle {
    font-size: 0.9rem;
  }

  .course-stats-bar {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
  }

  .course-cta-row {
    flex-direction: column;
  }
}
</style>
