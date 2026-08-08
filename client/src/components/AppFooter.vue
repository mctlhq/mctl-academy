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
    <MFooter :links="links" copyright="mctl Academy" />
  </div>
</template>

<style scoped>
.app-footer-safe {
  padding-right: env(safe-area-inset-right);
  padding-bottom: env(safe-area-inset-bottom);
  padding-left: env(safe-area-inset-left);
}
</style>
