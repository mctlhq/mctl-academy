<script setup lang="ts">
/**
 * Skip-to-content link. The click is handled here rather than left to the
 * fragment: in a web-history app a `#fragment` navigation reaches vue-router,
 * changes the route's fullPath (part of App's RouterView key) and remounts
 * the page, losing an open question or a running mock. The href stays as the
 * no-JavaScript fallback.
 */
const props = defineProps<{ target: string }>();

function skip() {
  document.getElementById(props.target)?.focus();
}
</script>

<template>
  <a class="skip-link" :href="`#${target}`" @click.prevent="skip">Skip to content</a>
</template>
