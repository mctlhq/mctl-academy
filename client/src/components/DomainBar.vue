<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  label: string;
  value: number;
  detail?: string;
}>();

const tone = computed(() => {
  if (props.value >= 80) return "var(--status-ok)";
  if (props.value >= 55) return "var(--status-warn)";
  return "var(--status-bad)";
});
</script>

<template>
  <div class="domain-bar">
    <div class="domain-bar-labels">
      <span>{{ label }}</span>
      <span class="domain-bar-value">{{ value }}%<small v-if="detail"> {{ detail }}</small></span>
    </div>
    <div
      class="domain-bar-track"
      role="progressbar"
      :aria-label="`${label} readiness`"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="value"
    >
      <div class="domain-bar-fill" :style="{ width: `${value}%`, backgroundColor: tone }" />
    </div>
  </div>
</template>

<style scoped>
.domain-bar-labels {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.4rem;
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
}

.domain-bar-value {
  flex: none;
  font-family: var(--font-mono);
  font-size: 0.8rem;
}

.domain-bar-value small {
  color: var(--surface-fg-subtle);
  font-size: 0.7rem;
}

.domain-bar-track {
  height: 6px;
  overflow: hidden;
  border-radius: var(--mctl-radius-pill);
  background: var(--surface-card);
  box-shadow: inset 0 0 0 1px var(--surface-line);
}

.domain-bar-fill {
  height: 100%;
  min-width: 2px;
  border-radius: inherit;
  transition: width var(--mctl-motion-duration-base) var(--mctl-motion-easing-standard);
}
</style>
