<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import { useRouter } from "vue-router";
import { calculateStudyStreak, getMistakeQuestionIds, progressVersion } from "../services/progressStore";
import { useCourseStore } from "../services/courseStore";
import { questionIdsForCourse } from "../services/contentBundle";
import { findCourse } from "../services/courseCatalog";
import { currentTheme, setTheme } from "../theme";
import UserNav from "./UserNav.vue";
import type { UserProfile } from "../types/user";

defineProps<{ user: UserProfile | null; loading: boolean }>();

const router = useRouter();
const theme = ref(currentTheme());
const streak = ref(calculateStudyStreak());
// Courses come from the generated catalog (content/courses/*.yaml), including
// ones with no published questions yet — those render disabled as "Coming
// soon" rather than being hidden, so the roadmap is visible without ever
// letting a learner select a course that would show another course's content.
const { courses, currentCourseId, setCourse } = useCourseStore();
// The select may truncate a long title on a phone; its title attribute and
// every learning page's own context line carry the full name.
const currentCourse = computed(() => findCourse(currentCourseId.value));

function onCourseChange(e: Event) {
  const target = e.target as HTMLSelectElement;
  if (!target?.value) return;
  if (!setCourse(target.value)) {
    // Rejected (unavailable course): put the control back where it was.
    target.value = currentCourseId.value ?? "";
  }
}
function toggleTheme() {
  const next = theme.value === "dark" ? "light" : "dark";
  setTheme(next);
  theme.value = next;
}

// AppNav is not remounted on navigation (unlike the routed views), so its
// mistake-count badge needs its own refresh trigger: every completed
// navigation, and every time App.vue bumps syncVersion after a
// syncFromServer() completes.
// Scoped to the selected course, like the Mistakes screen the badge links to:
// the badge and the page behind it must never disagree.
function courseMistakeCount(): number {
  const inCourse = questionIdsForCourse(currentCourseId.value);
  return getMistakeQuestionIds().filter((id) => inCourse.has(id)).length;
}

const mistakeCount = ref(courseMistakeCount());
function refreshLearningSummary() {
  mistakeCount.value = courseMistakeCount();
  streak.value = calculateStudyStreak();
}
router.afterEach(refreshLearningSummary);
watch(currentCourseId, refreshLearningSummary);
watch(progressVersion, refreshLearningSummary);
const syncVersion = inject<Ref<number>>("syncVersion");
if (syncVersion) {
  watch(syncVersion, refreshLearningSummary);
}

// Mobile drawer (mctl-design 0.20.0 site.css owns the look; the behaviour is
// ours): data-nav-open on the header, Escape / outside click / navigation /
// viewport growth close it, focus returns to the burger.
const header = ref<HTMLElement | null>(null);
const burger = ref<HTMLButtonElement | null>(null);
const navOpen = ref(false);
function closeNav(returnFocus = false) {
  if (!navOpen.value) return;
  navOpen.value = false;
  if (returnFocus) burger.value?.focus();
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closeNav(true);
}
function onPointerDown(e: PointerEvent) {
  const nav = header.value?.querySelector(".mctl-site-nav");
  const target = e.target as Node;
  if (navOpen.value && !nav?.contains(target) && !burger.value?.contains(target)) closeNav();
}
const wide =
  typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(min-width: 981px)") : null;
function onWide(e: MediaQueryListEvent) {
  if (e.matches) closeNav();
}
onMounted(() => {
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("pointerdown", onPointerDown);
  wide?.addEventListener("change", onWide);
});
onBeforeUnmount(() => {
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("pointerdown", onPointerDown);
  wide?.removeEventListener("change", onWide);
});
router.afterEach(() => closeNav());

const links = [
  { to: "/", label: "Home" },
  { to: "/practice", label: "Practice" },
  { to: "/mock", label: "Mock exam" },
  { to: "/mistakes", label: "Mistakes", isMistakes: true },
  { to: "/dashboard", label: "Progress" },
];
</script>

<template>
  <header
    ref="header"
    class="mctl-site-header mctl-site-header--app mctl-site-header--drawer-wide app-nav"
    :data-nav-open="navOpen ? '' : null"
  >
    <div class="mctl-site-container mctl-site-header__inner">
      <RouterLink to="/" class="mctl-site-brand app-brand" aria-label="mctl Academy home"
        ><span class="mctl-site-brand__accent">M</span>CTL<span class="app-brand-suffix"
          >&nbsp;academy</span
        ></RouterLink
      >
      <div class="mctl-site-header__context app-nav-context">
        <label class="sr-only" for="course-select">Course</label>
        <select
          id="course-select"
          class="course-select"
          data-testid="course-select"
          :title="currentCourse?.title"
          :value="currentCourseId ?? ''"
          @change="onCourseChange"
        >
          <option v-for="c in courses" :key="c.id" :value="c.id" :disabled="!c.available">
            {{ c.available ? c.title : `${c.title} — Coming soon` }}
          </option>
        </select>
      </div>
      <nav id="site-nav" class="mctl-site-nav" aria-label="Main">
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="app-nav-link"
          :aria-label="link.isMistakes ? `Mistakes, ${mistakeCount} to review` : link.label"
        >
          <span>{{ link.label }}</span>
          <span
            v-if="link.isMistakes"
            class="mctl-site-badge mistake-badge"
            :class="{ 'mistake-badge-empty': mistakeCount === 0 }"
            data-testid="mistake-badge"
            aria-hidden="true"
            >{{ mistakeCount }}</span
          >
        </RouterLink>
      </nav>
      <div class="mctl-site-header__actions">
        <span v-if="streak > 0" class="streak">
          <span aria-hidden="true">●</span> Practiced {{ streak }} {{ streak === 1 ? "day" : "days" }} in a
          row
        </span>
        <button
          type="button"
          class="theme-toggle"
          :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`"
          @click="toggleTheme"
        >
          <svg v-if="theme === 'dark'" aria-hidden="true" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="3.5" />
            <path
              d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"
            />
          </svg>
          <svg v-else aria-hidden="true" viewBox="0 0 24 24">
            <path d="M20.5 15.2A8.5 8.5 0 0 1 8.8 3.5 8.5 8.5 0 1 0 20.5 15.2Z" />
          </svg>
        </button>
        <UserNav :user="user" :loading="loading" />
      </div>
      <button
        ref="burger"
        type="button"
        class="mctl-site-burger"
        aria-label="Menu"
        aria-controls="site-nav"
        :aria-expanded="navOpen"
        @click="navOpen = !navOpen"
      ></button>
    </div>
  </header>
</template>

<style scoped>
/* Shell, active item, badge, burger and drawer come from ui.mctl.ai site.css
   (0.20.0). What is left here is academy-only: the course select, the theme
   toggle, the streak and the account control. */
.app-brand-suffix {
  color: var(--surface-fg-muted);
  font-weight: 400;
}

.course-select {
  min-width: 0;
  max-width: 14rem;
  height: 2rem;
  padding: 0 0.6rem;
  text-overflow: ellipsis;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md);
  background: var(--surface-bg);
  color: var(--surface-fg);
  font: inherit;
  font-size: 0.8rem;
  cursor: pointer;
}

.course-select:hover {
  border-color: var(--surface-line-strong);
}

.course-select:focus-visible {
  outline: var(--focus-ring-width) solid var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}

.mistake-badge-empty {
  color: var(--surface-fg-subtle);
}

.streak {
  color: var(--surface-fg-subtle);
  font-size: 0.75rem;
  white-space: nowrap;
}

.streak span {
  color: var(--status-ok);
}

.theme-toggle {
  display: inline-grid;
  width: 2rem;
  height: 2rem;
  padding: 0;
  place-items: center;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md);
  background: transparent;
  color: var(--surface-fg-muted);
  cursor: pointer;
}

.theme-toggle:hover {
  border-color: var(--surface-line-strong);
  color: var(--surface-fg);
}

.theme-toggle svg {
  width: 1rem;
  height: 1rem;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.6;
}

@media (max-width: 1120px) {
  .streak {
    display: none;
  }
}

/* 44px touch targets through tablet width. */
@media (max-width: 980px) {
  .theme-toggle,
  .course-select,
  .mctl-site-burger,
  .app-nav-link,
  .user-nav-signed-in :deep(summary),
  .user-nav-signin :deep(.signin-github),
  .user-nav-signin :deep(.signin-zitadel) {
    min-width: 2.75rem;
    min-height: 2.75rem;
  }
}

/* The ZITADEL long label is operator text of any length: bound it so it cannot
   squeeze the course picker (was 561-980px before the shared shell). */
@media (min-width: 561px) and (max-width: 980px) {
  .user-nav-signin :deep(.signin-zitadel .signin-label) {
    display: inline-block;
    max-width: 14rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    vertical-align: bottom;
  }
}

/* Up to 980px the nav is the drawer (.mctl-site-header--drawer-wide: brand,
   course, five tabs and the account control do not fit one row below that).
   Actions take the free space and the burger sits at the right edge. */
@media (max-width: 980px) {
  .mctl-site-header__actions {
    margin-left: auto;
    gap: 8px;
  }

  .mctl-site-burger {
    margin-left: 0;
  }
}

@media (max-width: 767px) {
  .user-nav-signin :deep(.signin-label) {
    display: none;
  }

  .user-nav-signin :deep(.signin-github) {
    justify-content: center;
    padding: 0;
  }

  .user-nav-signin :deep(.signin-zitadel .signin-label-short) {
    display: inline-block;
    max-width: 6rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    vertical-align: bottom;
  }
}

/* Phones: the course name is what changes every tab, so it keeps room. */
@media (max-width: 560px) {
  .mctl-site-header__inner {
    gap: 4px;
  }

  .mctl-site-header__context {
    padding-inline: 0 4px;
  }

  .course-select {
    flex: 1 1 auto;
    min-width: 5.5rem;
    padding-inline: 0.4rem;
  }

  .mctl-site-header__actions {
    gap: 4px;
  }
}

@media (max-width: 400px) {
  .app-brand-suffix {
    display: none;
  }
}
</style>
