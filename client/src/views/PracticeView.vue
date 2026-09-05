<script setup lang="ts">
import { computed, inject, type Ref } from "vue";
import { useRoute } from "vue-router";
import { practiceStorageKey } from "../practice/usePracticeSession";
import type { UserProfile } from "../types/user";
import PracticeContent from "../practice/PracticeContent.vue";
import { useCourseStore } from "../services/courseStore";
import { questionsForCourse } from "../services/contentBundle";

// Course scoping happens here, before a session exists: PracticeContent (and
// the session engine underneath it) only ever sees one course's questions.
const { currentCourseId } = useCourseStore();
const route = useRoute();
const user = inject<Ref<UserProfile | null>>("currentUser");
const mode = computed(() => (route.query.mode === "all" ? "all" : "remaining"));
const domain = computed(() => (typeof route.query.domain === "string" ? route.query.domain : ""));
const bundle = computed(() =>
  questionsForCourse(currentCourseId.value).filter((q) => !domain.value || q.domain === domain.value),
);
const sessionKey = computed(() =>
  practiceStorageKey(user?.value?.id ?? null, currentCourseId.value ?? "", mode.value, domain.value),
);
</script>

<template>
  <PracticeContent
    :key="sessionKey"
    :storage-key="sessionKey"
    :mode="mode"
    :bundle="bundle"
    title="Practice"
  />
</template>
