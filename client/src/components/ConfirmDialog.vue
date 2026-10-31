<script setup lang="ts">
import { MButton, MModal } from "@mctlhq/ui";

/**
 * The app's one confirmation surface, replacing window.confirm/alert. MModal
 * already owns focus trapping, Escape and focus return to the trigger; this
 * adds the confirm/cancel pair, a danger tone, and a pending state that
 * blocks a second submission and dismissal while the action is in flight.
 */
withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    confirmLabel: string;
    cancelLabel?: string;
    danger?: boolean;
    pending?: boolean;
    pendingLabel?: string;
    error?: string | null;
  }>(),
  { cancelLabel: "Cancel", danger: false, pending: false, pendingLabel: "Working…", error: null },
);
const emit = defineEmits<{ confirm: []; cancel: [] }>();
</script>

<template>
  <MModal
    :open="open"
    :title="title"
    :dismissible="!pending"
    @update:open="(value: boolean) => !value && emit('cancel')"
  >
    <div class="confirm-body"><slot /></div>
    <p v-if="error" class="confirm-error" role="alert">{{ error }}</p>
    <template #footer>
      <div class="confirm-actions">
        <MButton type="button" variant="ghost" :disabled="pending" @click="emit('cancel')">
          {{ cancelLabel }}
        </MButton>
        <MButton
          type="button"
          class="confirm-submit"
          :class="{ 'confirm-danger': danger }"
          :disabled="pending"
          @click="emit('confirm')"
        >
          {{ pending ? pendingLabel : confirmLabel }}
        </MButton>
      </div>
    </template>
  </MModal>
</template>

<style scoped>
.confirm-body {
  color: var(--surface-fg-muted);
}

.confirm-body :deep(p) {
  margin: 0 0 0.75rem;
}

.confirm-error {
  margin: 0.75rem 0 0;
  color: var(--status-bad);
}

.confirm-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.5rem;
}

.confirm-danger {
  border-color: var(--status-bad) !important;
  background: var(--status-bad) !important;
}
</style>
