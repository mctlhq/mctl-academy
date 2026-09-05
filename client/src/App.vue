<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import { useRoute } from "vue-router";
import AppNav from "./components/AppNav.vue";
import AppFooter from "./components/AppFooter.vue";
import { authClient } from "./authClient";
import type { UserProfile } from "./types/user";
import { useCourseStore } from "./services/courseStore";
import { setSyncEnabled, syncFromServer } from "./services/progressStore";

const sessionState = authClient.useSession();
const route = useRoute();
const focusedPractice = computed(() => route.name === "practice" || route.name === "mistakes");
const authLoading = computed(() => sessionState.value?.isPending ?? true);
const user = computed<UserProfile | null>(
  () => (sessionState.value?.data?.user as UserProfile | undefined) ?? null,
);

// Exposed so any routed view can gate authenticated-only UI (e.g.
// PracticeContent.vue's vote widget) without re-calling
// authClient.useSession() a second time or prop-drilling through RouterView —
// same pattern as syncVersion below.
provide("currentUser", user);

// Bumped after a successful syncFromServer() so views that inject it (see
// AppNav.vue, DashboardScreen.vue, HomeScreen.vue, MistakesView.vue) can
// reactively refresh their progress/mistake data. Deliberately NOT part of
// the RouterView remount key below: background sync must not interrupt an
// open question or a running Mock. Local writes also notify progressVersion.
const syncVersion = ref(0);
provide("syncVersion", syncVersion);

// The course-switch remount boundary. Every learning surface is scoped to the
// selected course and account. Remount to restore that scope's own persisted
// session rather than re-filtering a running session in place.
const { currentCourseId } = useCourseStore();

watch(
  () => [authLoading.value, user.value?.id],
  (_value, _oldValue, onCleanup) => {
    if (authLoading.value) return;

    if (user.value) {
      let cancelled = false;
      onCleanup(() => {
        cancelled = true;
      });

      setSyncEnabled(true);
      syncFromServer()
        .then(() => {
          // Auth state may have changed again before this settled (e.g. the
          // learner signed out mid-sync) — a stale callback must not bump
          // syncVersion against a state it no longer corresponds to.
          if (!cancelled) {
            syncVersion.value += 1;
          }
        })
        .catch((err) => {
          // A failed sync leaves local progress as the source of truth for
          // this session — not ideal, but strictly better than an unhandled
          // rejection, and there is nothing actionable for the learner to do
          // about a transient network/server failure here.
          console.error("[sync] Failed to sync progress from server:", err);
        });
    } else {
      setSyncEnabled(false);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div class="app-shell" :class="{ 'focused-practice': focusedPractice }">
    <AppNav :user="user" :loading="authLoading" />

    <main class="app-main">
      <RouterView v-slot="{ Component, route: currentRoute }">
        <component
          v-if="!focusedPractice || !authLoading"
          :is="Component"
          :key="`${currentRoute.fullPath}-${currentCourseId}-${user?.id ?? 'guest'}`"
        />
      </RouterView>
    </main>

    <AppFooter />
  </div>
</template>
