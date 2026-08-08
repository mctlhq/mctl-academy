<script setup lang="ts">
import { inject, ref, watch, type Ref } from "vue";
import { useRouter } from "vue-router";
import { calculateStudyStreak, getMistakeQuestionIds } from "../services/progressStore";
import { currentTheme, setTheme } from "../theme";
import UserNav from "./UserNav.vue";
import type { UserProfile } from "../types/user";

defineProps<{ user: UserProfile | null; loading: boolean }>();

const router = useRouter();
const theme = ref(currentTheme());
const streak = ref(calculateStudyStreak());
function toggleTheme() {
  const next = theme.value === "dark" ? "light" : "dark";
  setTheme(next);
  theme.value = next;
}

// AppNav is not remounted on navigation (unlike the routed views), so its
// mistake-count badge needs its own refresh trigger: every completed
// navigation, and every time App.vue bumps syncVersion after a
// syncFromServer() completes.
const mistakeCount = ref(getMistakeQuestionIds().length);
function refreshLearningSummary() {
  mistakeCount.value = getMistakeQuestionIds().length;
  streak.value = calculateStudyStreak();
}
router.afterEach(refreshLearningSummary);
const syncVersion = inject<Ref<number>>("syncVersion");
if (syncVersion) {
  watch(syncVersion, refreshLearningSummary);
}

const links = [
  { to: "/", label: "Home" },
  { to: "/practice", label: "Practice" },
  { to: "/mock", label: "Mock exam" },
];
</script>

<template>
  <nav class="app-nav">
    <div class="app-nav-primary">
      <RouterLink to="/" class="app-brand" aria-label="mctl Academy home">mctl academy</RouterLink>
      <div class="app-nav-links">
        <RouterLink v-for="link in links" :key="link.to" :to="link.to" class="app-nav-link">
          {{ link.label }}
        </RouterLink>
        <RouterLink to="/mistakes" class="app-nav-link">
          Mistakes <span v-if="mistakeCount > 0" class="mistake-badge">{{ mistakeCount }}</span>
        </RouterLink>
        <RouterLink to="/dashboard" class="app-nav-link">Progress</RouterLink>
      </div>
    </div>

    <div class="app-nav-actions">
      <span v-if="streak > 0" class="streak"><span aria-hidden="true">●</span> {{ streak }}-day streak</span>
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
  padding: 0 var(--mctl-layout-page-padding, 1rem);
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

  .app-brand {
    grid-column: 1;
    grid-row: 1;
    min-height: 3rem;
    display: inline-flex;
    align-items: center;
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

  .streak {
    display: none;
  }
}

@media (max-width: 560px) {
  .app-nav {
    padding-right: 1rem;
    padding-left: 1rem;
  }
}
</style>
