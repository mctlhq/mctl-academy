<script setup lang="ts">
import { MButton } from "@mctlhq/ui";
import { authClient } from "../authClient";

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  image: string | null;
  /** Custom field, GitHub-only — see server/auth.mjs's mapProfileToUser. */
  githubLogin: string | null;
}

defineProps<{
  /** Resolved auth state, owned by App via authClient.useSession(). */
  user: UserProfile | null;
  /** True until that session lookup resolves. */
  loading: boolean;
}>();

async function handleLogout() {
  await authClient.signOut();
  window.location.reload();
}

async function handleDeleteAccount() {
  if (
    !window.confirm(
      "Delete your account? This permanently removes your sign-in, your attempts, and your reports. This cannot be undone.",
    )
  ) {
    return;
  }
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
      window.alert("Account deletion failed. Please try again, or contact support if this continues.");
      return;
    }
    window.location.reload();
  } catch {
    window.alert("Account deletion failed — check your connection and try again.");
  }
}
</script>

<template>
  <span v-if="loading" class="user-nav-checking">Checking session...</span>

  <div v-else-if="!user" class="user-nav-signin">
    <MButton
      type="button"
      variant="ghost"
      class="signin-github"
      @click="authClient.signIn.social({ provider: 'github', callbackURL: '/' })"
    >
      <svg height="16" width="16" viewBox="0 0 16 16" fill="currentColor">
        <path
          d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
        />
      </svg>
      Sign in with GitHub
    </MButton>
    <MButton
      type="button"
      variant="ghost"
      class="signin-google"
      @click="authClient.signIn.social({ provider: 'google', callbackURL: '/' })"
    >
      <svg height="16" width="16" viewBox="0 0 48 48">
        <path
          fill="#FFC107"
          d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
        />
        <path
          fill="#FF3D00"
          d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"
        />
        <path
          fill="#4CAF50"
          d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"
        />
        <path
          fill="#1976D2"
          d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
        />
      </svg>
      Sign in with Google
    </MButton>
  </div>

  <div v-else class="user-nav-signed-in">
    <img v-if="user.image" :src="user.image" :alt="user.githubLogin || user.name" class="user-nav-avatar" />
    <span class="user-nav-name">{{ user.githubLogin || user.name }}</span>
    <MButton type="button" variant="ghost" size="sm" class="user-nav-signout" @click="handleLogout">
      Sign out
    </MButton>
    <button
      type="button"
      class="user-nav-delete"
      title="Permanently delete your account and all your data"
      @click="handleDeleteAccount"
    >
      Delete account
    </button>
  </div>
</template>

<style scoped>
.user-nav-checking {
  font-size: 0.85rem;
  color: var(--surface-fg-muted);
}

.user-nav-signin,
.user-nav-signed-in {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}

.signin-github svg,
.signin-google svg {
  display: inline-block;
}

.user-nav-avatar {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 1px solid var(--surface-line);
}

.user-nav-name {
  font-weight: 600;
  font-size: 0.9rem;
}

.user-nav-signout {
  color: var(--status-bad) !important;
  border-color: var(--status-bad) !important;
}

.user-nav-delete {
  padding: 0.3rem 0.6rem;
  font-size: 0.75rem;
  background: transparent;
  border: none;
  color: var(--surface-fg-subtle);
  text-decoration: underline;
  cursor: pointer;
}
</style>
