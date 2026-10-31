<script setup lang="ts">
import { computed, inject, ref, watch, type Ref } from "vue";
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

const links = [
  { to: "/", label: "Home" },
  { to: "/practice", label: "Practice" },
  { to: "/mock", label: "Mock exam" },
  { to: "/mistakes", label: "Mistakes", isMistakes: true },
  { to: "/dashboard", label: "Progress" },
];
</script>

<template>
  <nav class="app-nav" aria-label="Main">
    <div class="app-nav-primary">
      <div class="app-nav-context">
        <RouterLink to="/" class="app-brand" aria-label="mctl Academy home"
          >mctl<span class="app-brand-suffix"> academy</span></RouterLink
        >
        <span class="app-nav-separator" aria-hidden="true">/</span>
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
      <div class="app-nav-links">
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
            class="mistake-badge"
            :class="{ 'mistake-badge-empty': mistakeCount === 0 }"
            data-testid="mistake-badge"
            aria-hidden="true"
            >{{ mistakeCount }}</span
          >
        </RouterLink>
      </div>
    </div>

    <div class="app-nav-actions">
      <span v-if="streak > 0" class="streak">
        <span aria-hidden="true">●</span> Practiced {{ streak }} {{ streak === 1 ? "day" : "days" }} in a row
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
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 3.5rem;
  gap: 1.5rem;
  padding-top: env(safe-area-inset-top);
  padding-right: calc(var(--mctl-layout-page-padding, 1rem) + env(safe-area-inset-right));
  padding-left: calc(var(--mctl-layout-page-padding, 1rem) + env(safe-area-inset-left));
  border-bottom: 1px solid var(--surface-line);
  background: var(--surface-elevated);
  position: sticky;
  top: 0;
  z-index: var(--mctl-z-index-nav);
}

.app-nav-primary,
.app-nav-context,
.app-nav-links,
.app-nav-actions {
  display: flex;
  align-items: center;
}

.app-nav-primary {
  min-width: 0;
  gap: 2rem;
}

/* Brand and course read as one breadcrumb, "mctl academy / Course": every
   tab to the right is scoped to the course, so the course belongs with the
   product name, not with account settings on the far side of the bar. */
.app-nav-context {
  min-width: 0;
  gap: 0.5rem;
}

.app-brand {
  flex: none;
  color: var(--surface-fg);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.app-nav-separator {
  flex: none;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.85rem;
}

.app-nav-links {
  align-self: stretch;
  gap: 1.5rem;
}

.app-nav-actions {
  flex: none;
  gap: 0.75rem;
}

.app-nav-link {
  display: inline-flex;
  align-items: center;
  min-height: 3.5rem;
  border-bottom: 2px solid transparent;
  color: var(--surface-fg-muted);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  font-weight: 500;
  text-decoration: none;
  white-space: nowrap;
}

.app-nav-link:hover {
  color: var(--surface-fg);
}

.app-nav-link.router-link-active {
  border-bottom-color: var(--accent);
  color: var(--accent);
}

.mistake-badge {
  display: inline-grid;
  min-width: 1.25rem;
  height: 1.25rem;
  margin-left: 0.4rem;
  padding: 0 0.3rem;
  box-sizing: border-box;
  place-items: center;
  border: 1px solid var(--status-bad);
  border-radius: var(--mctl-radius-pill);
  color: var(--status-bad);
  font-size: 0.7rem;
  font-variant-numeric: tabular-nums;
}

.mistake-badge-empty {
  border-color: var(--surface-line);
  color: var(--surface-fg-subtle);
}

.streak {
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  white-space: nowrap;
}

.streak span {
  color: var(--status-ok);
}

/* A native select is as wide as its longest option, so every new course
   title (and its "Coming soon" suffix) would widen the bar without bound.
   Capping it keeps the layout independent of the catalog; the open dropdown
   still shows full titles, and the title attribute names the current one. */
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
  font-family: var(--font-mono);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
}

.course-select:hover {
  border-color: var(--surface-line-strong);
}

.course-select:focus-visible {
  border-color: var(--surface-line-strong);
  outline: 2px solid var(--accent);
  outline-offset: 2px;
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

/* 981-1120px: one row still, but tighter so the breadcrumb, five tabs and
   the account control fit without the course select being squeezed. */
@media (min-width: 981px) and (max-width: 1120px) {
  .app-nav,
  .app-nav-primary {
    gap: 1.25rem;
  }

  .app-nav-links {
    gap: 1.1rem;
  }

  .course-select {
    max-width: 11rem;
  }

  .streak {
    display: none;
  }
}

@media (max-width: 980px) {
  .app-nav {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: 3.25rem 2.75rem;
    align-items: center;
    column-gap: 0.75rem;
    row-gap: 0;
  }

  .app-nav-primary {
    display: contents;
  }

  /* Column 1 is minmax(0, 1fr) so it can shrink once the account control
     needs room; min-width: 0 on the breadcrumb and the select lets the
     select take the squeeze (ending in an ellipsis) instead of the brand
     wrapping into a box narrower than its own words and overlapping it. */
  .app-nav-context {
    grid-column: 1;
    grid-row: 1;
    min-width: 0;
  }

  .course-select {
    flex: 0 1 auto;
  }

  .app-nav-actions {
    grid-column: 2;
    grid-row: 1;
    gap: 0.5rem;
  }

  .app-nav-links {
    grid-column: 1 / -1;
    grid-row: 2;
    width: 100%;
    overflow-x: auto;
    gap: 1.25rem;
    scrollbar-width: none;
  }

  .app-nav-link {
    min-height: 2.75rem;
  }

  /* 44px, the app's touch-target convention (.app-nav-link, .report-button
     and the mock footer all use 2.75rem), for every control in the stacked,
     touch-oriented layout. */
  .theme-toggle,
  .course-select,
  .user-nav-signed-in :deep(summary),
  .user-nav-signin :deep(.signin-github),
  .user-nav-signin :deep(.signin-zitadel) {
    min-width: 2.75rem;
    min-height: 2.75rem;
  }

  .streak {
    display: none;
  }
}

/* From 561px to the stacked layout's upper bound, the ZITADEL button still
   shows its long label ("Log in with <name>"), and the name is operator text
   (ZITADEL_DISPLAY_NAME) of any length. Unbounded, it widens the auto column
   until the breadcrumb is squeezed to nothing, so it ends in an ellipsis. */
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

@media (max-width: 560px) {
  .app-nav {
    padding-right: calc(1rem + env(safe-area-inset-right));
    padding-left: calc(1rem + env(safe-area-inset-left));
  }

  .course-select {
    padding: 0 0.45rem;
  }

  /* "Log in" next to the GitHub icon is overhead once the icon alone (with
     its aria-label) identifies the control; padding collapses to match so
     the icon fills its 44px box like .theme-toggle. */
  .user-nav-signin :deep(.signin-label) {
    display: none;
  }

  .user-nav-signin :deep(.signin-github) {
    justify-content: center;
    padding: 0;
  }

  /* The ZITADEL button has no icon to fall back on, so it swaps its long
     label for the short one (just the provider name), bounded like the
     select so operator text of any length cannot squeeze the breadcrumb. */
  .user-nav-signin :deep(.signin-zitadel .signin-label-short) {
    display: inline-block;
    max-width: 6rem;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    vertical-align: bottom;
  }

  .app-nav-links {
    gap: 0.75rem;
  }

  .app-nav-link {
    font-size: 0.78rem;
  }
}

/* Smallest phones: the product name shortens to "mctl" so the course name,
   the one that changes what every tab shows, keeps the room. */
@media (max-width: 400px) {
  .app-brand-suffix {
    display: none;
  }

  .app-nav-context {
    gap: 0.35rem;
  }

  .app-nav-links {
    gap: 0.6rem;
  }

  .mistake-badge {
    margin-left: 0.25rem;
  }
}
</style>
