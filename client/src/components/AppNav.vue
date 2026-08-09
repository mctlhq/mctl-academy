<script setup lang="ts">
import { inject, ref, watch, type Ref } from "vue";
import { useRouter } from "vue-router";
import { calculateStudyStreak, getMistakeQuestionIds } from "../services/progressStore";
import { useCourseStore } from "../services/courseStore";
import { questionIdsForCourse } from "../services/contentBundle";
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
  <nav class="app-nav">
    <div class="app-nav-primary">
      <RouterLink to="/" class="app-brand" aria-label="mctl Academy home">mctl academy</RouterLink>
      <div class="app-nav-links">
        <RouterLink
          v-for="link in links"
          :key="link.to"
          :to="link.to"
          class="app-nav-link"
          :aria-label="link.label"
        >
          <span>{{ link.label }}</span>
          <span v-if="link.isMistakes && mistakeCount > 0" class="mistake-badge">{{ mistakeCount }}</span>
        </RouterLink>
      </div>
    </div>

    <div class="app-nav-actions">
      <div class="course-select-wrapper">
        <label class="course-select-label" for="course-select">Course:</label>
        <select
          id="course-select"
          class="course-select"
          data-testid="course-select"
          aria-label="Course"
          :value="currentCourseId ?? ''"
          @change="onCourseChange"
        >
          <option v-for="c in courses" :key="c.id" :value="c.id" :disabled="!c.available">
            {{ c.available ? c.title : `${c.title} — Coming soon` }}
          </option>
        </select>
      </div>
      <span v-if="streak > 0" class="streak">
        <span aria-hidden="true">●</span> Practiced {{ streak }}
        {{ streak === 1 ? "day" : "days" }} in a row
      </span>
      <button
        type="button"
        class="theme-toggle"
        :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`"
        @click="toggleTheme"
      >
        <svg v-if="theme === 'dark'" aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="3.5" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42" />
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
  gap: 2rem;
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
.app-nav-links,
.app-nav-actions {
  display: flex;
  align-items: center;
}

.app-nav-primary {
  min-width: 0;
  gap: 2rem;
}

.app-brand {
  flex: none;
  color: var(--surface-fg);
  font-family: var(--font-mono);
  font-size: 0.85rem;
  font-weight: 600;
  text-decoration: none;
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
  font-size: 0.76rem;
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
  min-width: 1.15rem;
  height: 1.15rem;
  margin-left: 0.35rem;
  place-items: center;
  border: 1px solid var(--status-bad);
  border-radius: var(--mctl-radius-pill);
  color: var(--status-bad);
  font-size: 0.62rem;
}

.streak {
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  white-space: nowrap;
}

.streak span {
  color: var(--status-ok);
}

.course-select-wrapper {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.course-select-label {
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.7rem;
  white-space: nowrap;
}

.course-select {
  height: 2rem;
  padding: 0 0.6rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-md);
  background: var(--surface-bg);
  color: var(--surface-fg);
  font-family: var(--font-mono);
  font-size: 0.72rem;
  font-weight: 500;
  cursor: pointer;
}

.course-select:hover,
.course-select:focus {
  border-color: var(--surface-line-strong);
  outline: none;
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

@media (max-width: 980px) {
  .app-nav {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-rows: 3rem 2.75rem;
    align-items: center;
    gap: 0;
  }

  .app-nav-primary {
    display: contents;
  }

  .app-nav-actions {
    grid-column: 2;
    grid-row: 1;
  }

  /* Column 1 is `minmax(0, 1fr)` so it can shrink all the way to 0 once
     column 2's auto-sized content (course-select + theme-toggle + account
     control) needs more room than the viewport has — confirmed on a real
     Pixel 7 (and reproduced headlessly at the same 375px validation width)
     where the shrunk column made "mctl academy" wrap into a box narrower
     than either word, rendering past its own edge and overlapping the
     course-select on top of it. `min-width: 0` lets the item actually take
     that shrunk track size instead of forcing the grid to overflow to fit
     its min-content, and `overflow: hidden` + the nowrap/ellipsis pair stop
     it from bleeding into the next column when it does. */
  .app-brand {
    grid-column: 1;
    grid-row: 1;
    min-height: 3rem;
    min-width: 0;
    display: inline-flex;
    align-items: center;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
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

  /* 44px, matching the app's own established touch-target convention
     (.app-nav-link, .report-button, .mock-exam-footer button all use
     2.75rem). Previously this was 2.5rem (40px) and only applied at
     <=560px, so the unscoped 2rem (32px) desktop default was still in
     effect for the whole 561-980px band -- exactly where 768px sits,
     still inside this stacked/touch-oriented nav layout.
     .signin-github (UserNav.vue's signed-out control) joins this list for
     the same reason: it sits in `.app-nav-actions` next to course-select and
     theme-toggle, and was one of the auto-sized items that squeezed
     `.app-brand`'s minmax(0, 1fr) column down to the overlap fixed above. */
  .theme-toggle,
  .course-select,
  .user-nav-signed-in :deep(summary),
  .user-nav-signin :deep(.signin-github) {
    min-width: 2.75rem;
    min-height: 2.75rem;
  }

  .streak {
    display: none;
  }
}

@media (min-width: 981px) and (max-width: 1120px) {
  .streak {
    display: none;
  }
}

@media (max-width: 560px) {
  .app-nav {
    padding-right: calc(1rem + env(safe-area-inset-right));
    padding-left: calc(1rem + env(safe-area-inset-left));
  }

  .course-select-label {
    display: none;
  }

  .course-select {
    max-width: 8rem;
    padding: 0 0.4rem;
    font-size: 0.68rem;
    text-overflow: ellipsis;
  }

  /* Same label-hiding precedent as .course-select-label just above: below
     560px, .app-nav-actions has the least room to give, and "Log in" next
     to the GitHub icon was pure overhead once the icon alone (with its
     aria-label) is enough to identify the control. Padding is collapsed to
     match -- MButton's ghost variant pads for a text label that's now gone,
     so left as-is the icon would sit off-center in the 2.75rem box set
     above instead of filling it like .theme-toggle does. */
  .user-nav-signin :deep(.signin-label) {
    display: none;
  }

  .user-nav-signin :deep(.signin-github) {
    justify-content: center;
    padding: 0;
  }

  .app-nav-links {
    gap: 0.85rem;
  }
}
</style>
