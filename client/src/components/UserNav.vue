<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref, type Ref } from "vue";
import { MButton } from "@mctlhq/ui";
import { authClient } from "../authClient";
import type { UserProfile } from "../types/user";
import { syncFromServer, syncStatus } from "../services/progressStore";
import ConfirmDialog from "./ConfirmDialog.vue";
import { currentReturnPath } from "./returnPath";

defineProps<{
  /** Resolved auth state, owned by App via authClient.useSession(). */
  user: UserProfile | null;
  /** True until that session lookup resolves. */
  loading: boolean;
}>();

/**
 * The optional ZITADEL sign-in, shown only when the server reports it
 * configured (GET /api/sign-in-options). Any failure to ask leaves the
 * GitHub button alone, exactly as before ZITADEL existed.
 */
const zitadel = ref<{ providerId: string; label: string } | null>(null);

onMounted(async () => {
  try {
    const res = await fetch("/api/sign-in-options");
    if (!res.ok) return;
    const body = (await res.json()) as { zitadel?: { providerId: string; label: string } | null };
    zitadel.value = body.zitadel ?? null;
  } catch {
    zitadel.value = null;
  }
});

/**
 * One sign-in at a time, returning to the page it was started from (a
 * validated same-origin path, see returnPath.ts) instead of always "/".
 * A provider that fails to start is reported on screen, not only in the
 * console, and the buttons come back so the learner can retry.
 */
const signInPending = ref(false);
const signInError = ref<string | null>(null);

async function startSignIn(label: string, start: (callbackURL: string) => Promise<unknown>) {
  if (signInPending.value) return;
  signInPending.value = true;
  signInError.value = null;
  try {
    const res = (await start(currentReturnPath())) as { error?: unknown } | undefined;
    if (res?.error) {
      console.error(`${label} sign-in could not start:`, res.error);
      signInError.value = `Could not open ${label} sign-in. Please try again.`;
      signInPending.value = false;
    }
    // On success the browser is navigating to the provider; stay pending.
  } catch (err) {
    console.error(`${label} sign-in could not start:`, err);
    signInError.value = `Could not open ${label} sign-in. Check your connection and try again.`;
    signInPending.value = false;
  }
}

// Back from the provider's authorize page usually restores this page from
// the back/forward cache with its JS state intact; without this the sign-in
// buttons would stay disabled until a manual reload.
function onPageShow(event: PageTransitionEvent) {
  if (event.persisted) {
    signInPending.value = false;
    signInError.value = null;
  }
}
onMounted(() => window.addEventListener("pageshow", onPageShow));
onUnmounted(() => window.removeEventListener("pageshow", onPageShow));

function signInWithGitHub() {
  return startSignIn("GitHub", (callbackURL) =>
    authClient.signIn.social({ provider: "github", callbackURL }),
  );
}

function signInWithZitadel() {
  const provider = zitadel.value;
  if (!provider) return;
  return startSignIn(provider.label, (callbackURL) =>
    authClient.signIn.oauth2({ providerId: provider.providerId, callbackURL }),
  );
}

// Sync status as the store actually knows it — never inferred from sign-in.
const syncVersion = inject<Ref<number> | undefined>("syncVersion", undefined);
const syncLabel = computed(() => {
  switch (syncStatus.value) {
    case "syncing":
      return "Syncing progress…";
    case "synced":
      return "Progress synced";
    case "failed":
      return "Could not sync progress";
    default:
      return "Progress saved on this device";
  }
});
async function retrySync() {
  const outcome = await syncFromServer();
  if (outcome === "synced" && syncVersion) syncVersion.value += 1;
}

async function handleLogout() {
  await authClient.signOut();
  window.location.reload();
}

const confirmingDelete = ref(false);
const deletePending = ref(false);
const deleteError = ref<string | null>(null);

function openDeleteConfirm() {
  deleteError.value = null;
  confirmingDelete.value = true;
}

async function handleDeleteAccount() {
  if (deletePending.value) return;
  deletePending.value = true;
  deleteError.value = null;
  // Not a better-auth client call — this is this app's own endpoint (see
  // server/routes/account.mjs), since better-auth's own deleteUser()
  // requires email verification, which OAuth-only accounts don't have.
  //
  // fetch() does not reject on a non-2xx response, so response.ok must be
  // checked explicitly — otherwise a failed deletion (a transient 500, the
  // request never reaching the server) still reloads the page, and the
  // learner is left believing their GDPR erasure request succeeded when it
  // did not.
  try {
    const res = await fetch("/api/account", { method: "DELETE" });
    if (!res.ok) {
      deleteError.value = "Account deletion failed. Please try again, or contact support if this continues.";
      deletePending.value = false;
      return;
    }
    window.location.reload();
  } catch {
    deleteError.value = "Account deletion failed. Check your connection and try again.";
    deletePending.value = false;
  }
}
</script>

<template>
  <span v-if="loading" class="user-nav-checking">Checking session...</span>

  <div v-else-if="!user" class="user-nav-signin">
    <!--
      aria-label carries the accessible name even though the visible "Log
      in" text is hidden below 560px (AppNav.vue's ≤560px media query, the
      same one that hides .course-select-label) -- the icon alone would
      otherwise announce nothing to screen readers.
    -->
    <MButton
      type="button"
      variant="ghost"
      class="signin-github"
      :aria-label="zitadel ? 'Log in with GitHub' : 'Log in'"
      title="Sign in to sync your progress across devices"
      :disabled="signInPending"
      @click="signInWithGitHub"
    >
      <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
      <span class="signin-label">{{ zitadel ? "Log in with GitHub" : "Log in" }}</span>
    </MButton>
    <MButton
      v-if="zitadel"
      type="button"
      variant="ghost"
      class="signin-zitadel"
      :aria-label="`Log in with ${zitadel.label}`"
      title="Sign in to sync your progress across devices"
      :disabled="signInPending"
      @click="signInWithZitadel"
    >
      <span class="signin-label">Log in with {{ zitadel.label }}</span>
      <!--
        Below 560px AppNav.vue hides every .signin-label. GitHub keeps its
        icon; this button has none, so it shows the provider name alone
        instead of turning into an empty ghost button.
      -->
      <span class="signin-label-short" aria-hidden="true">{{ zitadel.label }}</span>
    </MButton>
    <!--
      Google sign-in is temporarily hidden — the launch flow isn't ready yet.
      Google stays configured server-side (server/auth.mjs); this is a
      UI-only toggle, not a provider removal.
    -->
    <span v-if="signInPending" class="signin-status" role="status">Opening sign-in…</span>
    <p v-if="signInError" class="signin-error" role="alert">{{ signInError }}</p>
  </div>

  <details v-else class="user-nav-signed-in">
    <summary :aria-label="`Account menu for ${user.githubLogin || user.name}`">
      <img v-if="user.image" :src="user.image" alt="" class="user-nav-avatar" />
      <span v-else class="user-nav-avatar user-nav-avatar-fallback" aria-hidden="true">
        {{ (user.githubLogin || user.name).slice(0, 1).toUpperCase() }}
      </span>
      <span class="user-nav-name">{{ user.githubLogin || user.name }}</span>
      <span class="chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="account-menu">
      <div class="account-identity">
        <strong>{{ user.name }}</strong>
        <span v-if="user.githubLogin">@{{ user.githubLogin }}</span>
      </div>
      <p class="sync-status" :class="`sync-${syncStatus}`" role="status" data-testid="sync-status">
        <span>{{ syncLabel }}</span>
        <button v-if="syncStatus === 'failed'" type="button" class="sync-retry" @click="retrySync">
          Retry
        </button>
      </p>
      <MButton type="button" variant="ghost" size="sm" class="user-nav-signout" @click="handleLogout">
        Log out
      </MButton>
      <div class="account-danger">
        <button type="button" class="user-nav-delete" @click="openDeleteConfirm">Delete account…</button>
      </div>
    </div>
    <ConfirmDialog
      :open="confirmingDelete"
      title="Delete your Academy account?"
      confirm-label="Delete account permanently"
      pending-label="Deleting…"
      danger
      :pending="deletePending"
      :error="deleteError"
      @confirm="handleDeleteAccount"
      @cancel="confirmingDelete = false"
    >
      <p>
        This permanently removes your Academy sign-in, attempts in every course, and stored reports. GitHub
        issues are managed by your GitHub account and are not deleted here.
      </p>
      <p><strong>This cannot be undone.</strong></p>
    </ConfirmDialog>
  </details>
</template>

<style scoped>
.user-nav-checking {
  font-size: 0.85rem;
  color: var(--surface-fg-muted);
}

.user-nav-signin,
.user-nav-signed-in summary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.signin-github svg,
.signin-google svg {
  display: inline-block;
}

.signin-label-short {
  display: none;
}

.user-nav-avatar {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  border: 1px solid var(--surface-line);
}

.user-nav-avatar-fallback {
  display: inline-grid;
  place-items: center;
  background: var(--surface-card);
  color: var(--surface-fg-muted);
  font-family: var(--font-mono);
  font-size: 0.7rem;
}

.user-nav-name {
  font-weight: 600;
  font-size: 0.78rem;
}

.user-nav-signed-in {
  position: relative;
}

.user-nav-signed-in summary {
  min-height: 2rem;
  list-style: none;
  color: var(--surface-fg);
  cursor: pointer;
}

.user-nav-signed-in summary::-webkit-details-marker {
  display: none;
}

.chevron {
  color: var(--surface-fg-subtle);
  font-size: 0.8rem;
}

.account-menu {
  position: absolute;
  top: calc(100% + 0.75rem);
  right: 0;
  display: grid;
  width: 13rem;
  gap: 0.4rem;
  padding: 0.75rem;
  border: 1px solid var(--surface-line-strong);
  border-radius: var(--mctl-radius-lg);
  background: var(--surface-elevated);
  box-shadow: var(--mctl-shadow-overlay);
}

.account-identity {
  display: grid;
  padding: 0.25rem 0.4rem 0.75rem;
  border-bottom: 1px solid var(--surface-line);
  font-size: 0.78rem;
}

.account-identity span {
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: 0.68rem;
}

.user-nav-signout {
  justify-content: flex-start;
}

.sync-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0;
  padding: 0.25rem 0.4rem;
  color: var(--surface-fg-subtle);
  font-size: 0.75rem;
}

.sync-status.sync-synced {
  color: var(--status-ok);
}

.sync-status.sync-failed {
  color: var(--status-bad);
}

.sync-retry {
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--surface-line-strong);
  border-radius: var(--mctl-radius-md);
  background: transparent;
  color: var(--surface-fg);
  font-size: 0.75rem;
  cursor: pointer;
}

.signin-status,
.signin-error {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  width: min(18rem, calc(100vw - 2rem));
  margin: 0;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--status-bad);
  border-radius: var(--mctl-radius-md);
  background: var(--surface-elevated);
  color: var(--surface-fg);
  font-size: 0.8rem;
  z-index: 1;
}

.signin-status {
  border-color: var(--surface-line-strong);
  color: var(--surface-fg-muted);
}

.user-nav-signin {
  position: relative;
}

.account-danger {
  margin-top: 0.25rem;
  padding-top: 0.5rem;
  border-top: 1px solid var(--surface-line);
}

.user-nav-delete {
  width: 100%;
  min-height: 2rem;
  padding: 0.3rem 0.6rem;
  font-size: 0.78rem;
  background: transparent;
  border: none;
  color: var(--surface-fg-subtle);
  text-align: left;
  cursor: pointer;
}

.user-nav-delete:hover {
  color: var(--status-bad);
}

@media (max-width: 620px) {
  .user-nav-name,
  .chevron {
    display: none;
  }
}
</style>
