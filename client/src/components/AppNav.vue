<script setup lang="ts">
import { inject, ref, watch, type Ref } from "vue";
import { useRouter } from "vue-router";
import { MButton } from "@mctlhq/ui";
import { getMistakeQuestionIds } from "../services/progressStore";
import { currentTheme, setTheme } from "../theme";
import UserNav, { type UserProfile } from "./UserNav.vue";

defineProps<{ user: UserProfile | null; loading: boolean }>();

const router = useRouter();
const theme = ref(currentTheme());
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
router.afterEach(() => {
  mistakeCount.value = getMistakeQuestionIds().length;
});
const syncVersion = inject<Ref<number>>("syncVersion");
if (syncVersion) {
  watch(syncVersion, () => {
    mistakeCount.value = getMistakeQuestionIds().length;
  });
}

const links = [
  { to: "/practice", label: "Practice Bank" },
  { to: "/mock", label: "Mock Exam (30 Questions)" },
  { to: "/dashboard", label: "Progress Dashboard" },
];
</script>

<template>
  <nav class="app-nav">
    <div class="app-nav-links">
      <RouterLink v-for="link in links" :key="link.to" :to="link.to" class="app-nav-link">
        {{ link.label }}
      </RouterLink>
      <RouterLink to="/mistakes" class="app-nav-link">
        Review Mistakes ({{ mistakeCount }})
      </RouterLink>
    </div>

    <div class="app-nav-actions">
      <MButton
        type="button"
        variant="ghost"
        size="sm"
        :aria-label="`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`"
        @click="toggleTheme"
      >
        {{ theme === "dark" ? "☀" : "☾" }}
      </MButton>
      <UserNav :user="user" :loading="loading" />
    </div>
  </nav>
</template>

<style scoped>
.app-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem var(--mctl-layout-page-padding, 1rem);
  border-bottom: 1px solid var(--surface-line);
  background: var(--surface-elevated);
  flex-wrap: wrap;
}

.app-nav-links {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.app-nav-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.app-nav-link {
  padding: 0.5rem 1rem;
  border: 1px solid var(--surface-line);
  border-radius: var(--mctl-radius-sm, 4px);
  color: var(--surface-fg);
  text-decoration: none;
  font-size: 0.9rem;
}

.app-nav-link:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.app-nav-link.router-link-active {
  background: var(--accent);
  color: var(--mctl-color-ink, #fff);
  border-color: var(--accent);
  font-weight: 600;
}
</style>
