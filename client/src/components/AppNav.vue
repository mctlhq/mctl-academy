<script setup lang="ts">
import { computed, inject, onBeforeUnmount, onMounted, ref, watch, type Ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { MSelect } from "@mctlhq/ui";
import { calculateStudyStreak, getMistakeQuestionIds, progressVersion } from "../services/progressStore";
import { useCourseStore } from "../services/courseStore";
import { questionIdsForCourse } from "../services/contentBundle";
import { findCourse } from "../services/courseCatalog";
import { currentTheme, setTheme } from "../theme";
import UserNav from "./UserNav.vue";
import type { UserProfile } from "../types/user";

defineProps<{ user: UserProfile | null; loading: boolean }>();

const router = useRouter();
const route = useRoute();
const theme = ref(currentTheme());
const streak = ref(calculateStudyStreak());
// Courses come from the generated catalog (content/courses/*.yaml), including
// ones with no published questions yet — those render disabled as "Coming
// soon" rather than being hidden, so the roadmap is visible without ever
// letting a learner select a course that would show another course's content.
const { courses, currentCourseId, setCourse, canSelect } = useCourseStore();
// The select may truncate a long title on a phone; its title attribute and
// every learning page's own context line carry the full name.
const currentCourse = computed(() => findCourse(currentCourseId.value));

// MSelect options: unavailable courses stay listed but disabled, so the
// roadmap is visible without ever being selectable.
const courseOptions = computed(() =>
  courses.map((c) => ({
    value: c.id,
    label: c.available ? c.title : `${c.title} — Coming soon`,
    disabled: !c.available,
  })),
);

const courseContext = ref<HTMLElement | null>(null);

async function onCourseChange(next: string) {
  if (!next) return;
  const revert = () => {
    // Put the control back where it was (unavailable course, or a
    // navigation that did not happen). MSelect is controlled by
    // currentCourseId, which did not change, so nothing re-renders it: the
    // native control still shows the refused pick until it is reset here.
    const control = courseContext.value?.querySelector("select");
    if (control) control.value = currentCourseId.value ?? "";
  };
  // On a course page the page *is* the course, so picking another one has to
  // move to that course's page: changing only the stored selection left the
  // learner looking at course X with course Y in the switcher. Navigate first
  // and select after — selecting first would remount the still-current
  // /courses/X view (App.vue keys it on the course id), which syncs the store
  // back to X.
  if (route.name === "course") {
    if (!canSelect(next)) return revert();
    const failure = await router.push(`/courses/${encodeURIComponent(next)}`);
    if (failure) return revert();
    setCourse(next);
    return;
  }
  if (!setCourse(next)) revert();
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
        ><span class="mctl-site-brand__accent">M</span><span class="app-brand-rest">CTL</span
        ><span class="app-brand-suffix">&nbsp;academy</span></RouterLink
      >
      <div
        ref="courseContext"
        class="mctl-site-header__context mctl-site-header__context--select app-nav-context"
      >
        <label class="sr-only" for="course-select">Course</label>
        <MSelect
          id="course-select"
          size="sm"
          class="course-select"
          data-testid="course-select"
          :title="currentCourse?.title"
          :options="courseOptions"
          :model-value="currentCourseId ?? ''"
          @update:model-value="onCourseChange"
        />
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

/* The switcher is MSelect size="sm" in site.css's --select context (0.21.0),
   which supplies the header type, chevron and focus state; only the width
   cap is ours. */
.course-select {
  max-width: 14rem;
}

.mistake-badge-empty {
  color: var(--surface-fg-subtle);
}

.streak {
  color: var(--surface-fg-subtle);
  font-size: var(--text-caption-size);
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
  .mctl-site-burger,
  .app-nav-link,
  .user-nav-signed-in :deep(summary),
  .user-nav-signin :deep(.signin-github),
  .user-nav-signin :deep(.signin-zitadel) {
    min-width: 2.75rem;
    min-height: 2.75rem;
  }

  /* The control, not MSelect's wrapper: outranks the sm height (0,3,0). */
  .app-nav-context .course-select :deep(.m-select__control) {
    height: 2.75rem;
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
   The burger sits inside the actions slot, as the site.css 0.20.2 header
   contract asks, so it keeps the slot's gap next to the account control. */

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

  /* site.css caps the context at 40vw once the burger shows, which left
     "AI Clo…" at 375px. Here the course takes all the room the brand and the
     actions leave instead (a min-width would only push the burger into the
     page gutter). Chained to outrank site.css's :has() selector. */
  .app-nav.mctl-site-header .mctl-site-header__context.app-nav-context {
    flex: 1 1 auto;
    min-width: 0;
    max-width: none;
  }

  .course-select {
    flex: 1 1 auto;
    max-width: none;
  }

  .app-nav-context .course-select :deep(.m-select__control) {
    padding-inline: 0.5rem 1.5rem;
  }

  .mctl-site-header__actions {
    gap: 4px;
  }
}

@media (max-width: 400px) {
  .app-brand-suffix {
    display: none;
  }

  /* At 375px the brand, three 44px actions and the gutters leave the course
     about 100px, which is "Agenti…". The accent M alone still reads as the
     mark (the link keeps its "mctl Academy home" label) and gives the course
     name about 55px more. */
  .app-brand-rest {
    display: none;
  }

  /* A tighter chevron gutter and a 14px label are the last few letters of
     the longest titles. */
  .app-nav-context .course-select :deep(.m-select__control) {
    padding-inline: 0.4rem 1.1rem;
    font-size: 0.875rem;
  }

  .app-nav-context .course-select :deep(.m-select__chevron) {
    right: 0.4rem;
  }

  /* The "/" separator and its gap are 16px of course name at 375px. */
  .app-nav.mctl-site-header .mctl-site-header__context.app-nav-context {
    gap: 0;
  }

  .app-nav.mctl-site-header .mctl-site-header__context.app-nav-context::before {
    content: none;
  }
}
</style>
