<script setup lang="ts">
import { computed } from "vue";
import { parseRestrictedMarkdown } from "../markdown";

const props = defineProps<{ text: string }>();

// Never v-html: parseRestrictedMarkdown's segments render as plain text
// nodes, matching the invariant the React version documented -- raw markup
// in a question stem/option/explanation can never execute.
const segments = computed(() => parseRestrictedMarkdown(props.text));
</script>

<template>
  <template v-for="(segment, index) in segments" :key="index">
    <code v-if="segment.type === 'code'">{{ segment.value }}</code>
    <span v-else>{{ segment.value }}</span>
  </template>
</template>
