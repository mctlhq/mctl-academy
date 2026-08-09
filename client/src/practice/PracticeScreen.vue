<script setup lang="ts">
import { ref } from "vue";
import { useQuarantineStore } from "../services/quarantineStore";
import PracticeContent from "./PracticeContent.vue";
import type { BundleQuestion } from "./usePracticeSession";

const props = withDefaults(
  defineProps<{
    bundle?: readonly BundleQuestion[];
    title?: string;
    emptyMessage?: string;
  }>(),
  { title: "Practice" },
);

const quarantineStore = useQuarantineStore();
const isLoadingQuarantine = ref(!props.bundle && !quarantineStore.isLoaded.value);

if (!props.bundle && !quarantineStore.isLoaded.value) {
  quarantineStore.fetchQuarantinedIds().finally(() => {
    isLoadingQuarantine.value = false;
  });
}
</script>

<template>
  <section v-if="isLoadingQuarantine" class="practice practice-loading">
    <h1>{{ title }}</h1>
    <p>Loading questions...</p>
  </section>

  <PracticeContent
    v-else
    :bundle="bundle"
    :title="title"
    :empty-message="emptyMessage"
  />
</template>

<style scoped>
.practice {
  width: min(100%, 43rem);
  margin: 0 auto;
}
.practice-loading p {
  color: var(--surface-fg-muted);
}
</style>
