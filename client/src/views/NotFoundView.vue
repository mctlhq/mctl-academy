<script setup lang="ts">
import { MButton } from "@mctlhq/ui";
import { RouterLink } from "vue-router";
</script>

<template>
  <section class="not-found page-shell" data-testid="not-found">
    <p class="not-found-code">404</p>
    <h1>This page does not exist</h1>
    <p class="not-found-lede">The link may be outdated or mistyped. Your progress is not affected.</p>
    <div class="not-found-actions">
      <MButton :as="RouterLink" to="/practice">Continue practice <span aria-hidden="true">→</span></MButton>
      <MButton :as="RouterLink" to="/" variant="ghost">Go to home</MButton>
    </div>
  </section>
</template>

<style scoped>
.not-found {
  max-width: 43rem;
}

.not-found-code {
  margin: 0 0 0.5rem;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-caption-size);
}

.not-found h1 {
  margin: 0 0 0.5rem;
  font-size: clamp(1.4rem, 3vw, 1.75rem);
}

.not-found-lede {
  margin: 0 0 1.5rem;
  color: var(--surface-fg-muted);
}

.not-found-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
</style>
