<script setup lang="ts">
import { MFooter } from "@mctlhq/ui";

// Track E1 (production plan): surface the privacy policy in the UI —
// PRIVACY.md previously had zero references anywhere in client/src.
const links = [
  { label: "Privacy", href: "https://github.com/mctlhq/mctl-academy/blob/main/PRIVACY.md" },
  { label: "Legal", href: "https://github.com/mctlhq/mctl-academy/blob/main/LEGAL.md" },
  { label: "GitHub", href: "https://github.com/mctlhq/mctl-academy" },
];
</script>

<template>
  <div class="app-footer-safe">
    <p class="app-footer-disclaimer" data-testid="independence-disclaimer">
      mctl Academy is not affiliated with, endorsed by, or sponsored by Nebius, or by any other certification
      vendor.
    </p>
    <MFooter :links="links" copyright="mctl Academy" />
  </div>
</template>

<style scoped>
.app-footer-safe {
  padding-right: env(safe-area-inset-right);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
}

.app-footer-disclaimer {
  max-width: 72ch;
  margin: 0 auto;
  padding: 0.75rem 1rem 0;
  color: var(--surface-fg-muted);
  font-size: 0.8125rem;
  line-height: 1.5;
  text-align: center;
}
</style>
