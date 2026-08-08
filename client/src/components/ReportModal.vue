<script setup lang="ts">
import { ref } from "vue";
import { MModal, MButton, MField, MSelect, MTextarea } from "@mctlhq/ui";

const MAX_COMMENT_LENGTH = 2000;

const props = defineProps<{ questionId: string }>();
const emit = defineEmits<{ close: [] }>();

const reasonOptions = [
  { label: "Typo or formatting error", value: "typo" },
  { label: "Factual or technical inaccuracy", value: "factual_error" },
  { label: "Unclear or ambiguous question stem", value: "unclear_stem" },
  { label: "Incorrect or ambiguous distractor options", value: "bad_distractor" },
  { label: "Other feedback", value: "other" },
];

const reason = ref("typo");
const comment = ref("");
const status = ref<"idle" | "submitting" | "success" | "error">("idle");
const errorMessage = ref("");

async function handleSubmit() {
  status.value = "submitting";
  errorMessage.value = "";

  try {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_id: props.questionId,
        reason: reason.value,
        comment: comment.value,
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to submit report");
    }

    status.value = "success";
    setTimeout(() => {
      emit("close");
    }, 1500);
  } catch (err) {
    status.value = "error";
    errorMessage.value = err instanceof Error ? err.message : "Network error";
  }
}
</script>

<template>
  <MModal
    :open="true"
    title="Report an issue with this question"
    :dismissible="status !== 'submitting'"
    @update:open="emit('close')"
  >
    <p class="report-meta">
      Question ID: <code>{{ questionId }}</code>
    </p>

    <div v-if="status === 'success'" class="report-status success">
      Thank you! Your feedback has been submitted.
    </div>

    <form v-else @submit.prevent="handleSubmit">
      <MField label="Reason" for="report-reason">
        <template #default="{ describedBy, required }">
          <MSelect
            id="report-reason"
            v-model="reason"
            :options="reasonOptions"
            :disabled="status === 'submitting'"
            :aria-describedby="describedBy"
            :required="required"
          />
        </template>
      </MField>

      <MField label="Details (optional)" for="report-comment">
        <template #default="{ describedBy }">
          <MTextarea
            id="report-comment"
            v-model="comment"
            :rows="3"
            placeholder="Describe the issue in detail..."
            :maxlength="MAX_COMMENT_LENGTH"
            :disabled="status === 'submitting'"
            :aria-describedby="describedBy"
          />
        </template>
      </MField>
      <p class="report-char-count">{{ comment.length }} / {{ MAX_COMMENT_LENGTH }}</p>

      <p v-if="status === 'error'" class="report-error" role="alert">{{ errorMessage }}</p>

      <div class="report-actions">
        <MButton
          type="button"
          variant="ghost"
          :disabled="status === 'submitting'"
          @click="emit('close')"
        >
          Cancel
        </MButton>
        <MButton type="submit" :disabled="status === 'submitting'">
          {{ status === "submitting" ? "Submitting..." : "Submit Report" }}
        </MButton>
      </div>
    </form>
  </MModal>
</template>

<style scoped>
.report-meta {
  font-size: 0.85rem;
  color: var(--surface-fg-muted);
}

.report-status.success {
  padding: 1rem;
  color: var(--status-ok);
}

.report-char-count {
  margin: 0.25rem 0 1rem;
  font-size: 0.75rem;
  color: var(--surface-fg-subtle);
  text-align: right;
}

.report-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

form > :not(:last-child) {
  margin-bottom: 1rem;
}
</style>
