<script setup lang="ts">
import { computed, provide, ref, watch } from "vue";
import AppNav from "./components/AppNav.vue";
import AppFooter from "./components/AppFooter.vue";
import { authClient } from "./authClient";
import type { UserProfile } from "./components/UserNav.vue";
import { setSyncEnabled, syncFromServer } from "./services/progressStore";

const sessionState = authClient.useSession();
const authLoading = computed(() => sessionState.value?.isPending ?? true);
const user = computed<UserProfile | null>(() => (sessionState.value?.data?.user as UserProfile | undefined) ?? null);

// Bumped after a successful syncFromServer() so AppNav's mistake-count badge
// (and any currently-mounted routed view keyed on it) picks up progress that
// may have just been merged in from the server.
const syncVersion = ref(0);
provide("syncVersion", syncVersion);

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
  <AppNav :user="user" :loading="authLoading" />

  <main class="app-main">
    <RouterView v-slot="{ Component, route }">
      <component :is="Component" :key="`${route.fullPath}-${syncVersion}`" />
    </RouterView>
  </main>

  <AppFooter />
</template>
