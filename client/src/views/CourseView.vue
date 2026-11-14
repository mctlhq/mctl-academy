<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MButton } from "@mctlhq/ui";
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
const router = useRouter();
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

function startPractice(domainId?: string) {
  if (!course.value?.available) return;
  if (!setCourse(course.value.id)) return;
  if (domainId) {
    router.push(`/practice?domain=${encodeURIComponent(domainId)}`);
  } else {
    router.push("/practice");
  }
}

function startMock() {
  if (!course.value?.available) return;
  if (!setCourse(course.value.id)) return;
  router.push("/mock");
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
        <span class="course-tag">Practice track</span>
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
        <MButton type="button" @click="startPractice()">
          Start Practice ({{ totalQuestions }} questions) <span aria-hidden="true">→</span>
        </MButton>
        <MButton type="button" variant="ghost" @click="startMock()">
          Timed Mock Run ({{ course.mock.questionCount }} questions)
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
            <div class="domain-card-action">
              <button
                type="button"
                class="domain-btn-link"
                :aria-label="`Practice ${domain.title}`"
                @click="startPractice(domain.id)"
              >
                Practice this domain <span aria-hidden="true">→</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section v-if="otherCourses.length > 0" class="other-courses" aria-labelledby="other-courses-heading">
        <h2 id="other-courses-heading" class="section-heading">Explore other courses</h2>
        <div class="other-courses-grid">
          <RouterLink
            v-for="c in otherCourses"
            :key="c.id"
            :to="`/courses/${c.id}`"
            class="other-course-card"
          >
            <span class="other-course-title">{{ c.title }}</span>
            <span class="other-course-meta">{{ c.publishedQuestionCount }} questions</span>
          </RouterLink>
        </div>
      </section>
    </div>
  </div>

  <div
    v-else-if="course && !course.available"
    class="course-coming-soon page-shell"
    data-testid="course-coming-soon"
  >
    <p class="not-found-code">Coming soon</p>
    <h1>{{ course.title }}</h1>
    <p class="not-found-lede">
      Practice questions for this track are currently in preparation. Check back soon.
    </p>
    <div class="not-found-actions">
      <MButton type="button" @click="router.push('/practice')">Continue practice</MButton>
      <MButton type="button" variant="ghost" @click="router.push('/')">Go to Home</MButton>
    </div>
  </div>

  <div v-else class="course-not-found page-shell" data-testid="course-not-found">
    <p class="not-found-code">404</p>
    <h1>Course not found</h1>
    <p class="not-found-lede">The requested course could not be found or has been retired.</p>
    <div class="not-found-actions">
      <MButton type="button" @click="router.push('/')">Go to Home</MButton>
      <MButton type="button" variant="ghost" @click="router.push('/practice')">Continue practice</MButton>
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
  font-size: 0.8rem;
}

.course-breadcrumbs a {
  color: var(--surface-fg-muted);
  text-decoration: none;
}

.course-breadcrumbs a:hover {
  color: var(--accent);
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

.course-tag {
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: var(--mctl-radius-sm);
  background: var(--surface-card);
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
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
  font-size: 0.8rem;
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
  font-size: 0.75rem;
}

.domain-card-tag {
  color: var(--accent);
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
  margin: 0 0 1rem;
  font-size: 0.8rem;
  color: var(--surface-fg-muted);
}

.domain-card-action {
  margin-top: auto;
}

.domain-btn-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.domain-btn-link:hover,
.domain-btn-link:focus-visible {
  text-decoration: underline;
}

.other-courses {
  margin-bottom: 3rem;
}

.other-courses-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 1rem;
}

.other-course-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  padding: 1rem 1.25rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md);
  background: var(--surface-card);
  text-decoration: none;
  transition: border-color var(--mctl-motion-duration-base) var(--mctl-motion-easing-standard);
}

.other-course-card:hover,
.other-course-card:focus-visible {
  border-color: var(--accent);
}

.other-course-title {
  color: var(--surface-fg);
  font-weight: 500;
  font-size: 0.95rem;
}

.other-course-meta {
  color: var(--surface-fg-subtle);
  font-size: 0.75rem;
  font-family: var(--font-mono);
}

.not-found-code {
  margin: 0 0 0.5rem;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.8rem;
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
