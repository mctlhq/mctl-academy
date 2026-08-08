<script setup lang="ts">
import { computed, ref } from "vue";
import { MModal, MButton, MField, MSelect, MTextarea } from "@mctlhq/ui";
import { buildQuestionIssueUrl, questionIssueReasons } from "./questionIssue";

const MAX_COMMENT_LENGTH = 2000;

const props = defineProps<{ questionId: string }>();
const emit = defineEmits<{ close: [] }>();

const reason = ref("typo");
const comment = ref("");
const issueUrl = computed(() => buildQuestionIssueUrl(props.questionId, reason.value, comment.value));
</script>

<template>
  <MModal
    :open="true"
    title="Create a GitHub issue"
    @update:open="emit('close')"
  >
    <p class="report-intro">
      This opens a pre-filled issue in <strong>mctlhq/mctl-academy</strong>. You can review it on
      GitHub before submitting.
    </p>
    <p class="report-meta">
      Question ID: <code>{{ questionId }}</code>
    </p>

    <form @submit.prevent>
      <MField label="Reason" for="report-reason">
        <template #default="{ describedBy, required }">
          <MSelect
            id="report-reason"
            v-model="reason"
            :options="questionIssueReasons"
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
            :aria-describedby="describedBy"
          />
        </template>
      </MField>
      <p class="report-char-count">{{ comment.length }} / {{ MAX_COMMENT_LENGTH }}</p>

      <div class="report-actions">
        <MButton type="button" variant="ghost" @click="emit('close')">
          Cancel
        </MButton>
        <MButton as="a" :href="issueUrl" target="_blank" rel="noopener noreferrer">
          Continue to GitHub <span aria-hidden="true">↗</span>
        </MButton>
      </div>
    </form>
  </MModal>
</template>

<style scoped>
.report-intro,
.report-meta {
  font-size: 0.85rem;
  color: var(--surface-fg-muted);
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
