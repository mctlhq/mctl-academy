<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, type Ref } from "vue";
import { useRoute } from "vue-router";
import { practiceStorageKey } from "../practice/usePracticeSession";
import type { UserProfile } from "../types/user";
import PracticeContent from "../practice/PracticeContent.vue";
import { useCourseStore } from "../services/courseStore";
import { domainTitlesFor } from "../services/courseCatalog";
import { questionsForCourse } from "../services/contentBundle";
import { practiceHeadMeta } from "../seo/courseMeta.mjs";
import { applyHeadMeta, restoreHeadMeta, type SavedHeadDefaults } from "../seo/headTags";

// The same strings server/spa.mjs renders for /practice: canonical, og:url,
// description and the social title/description, restored on leaving.
const savedHeadDefaults: SavedHeadDefaults = new Map();

onMounted(() => {
  if (typeof document === "undefined") return;
  applyHeadMeta(practiceHeadMeta(), savedHeadDefaults);
});

onUnmounted(() => {
  if (typeof document === "undefined") return;
  restoreHeadMeta(savedHeadDefaults);
});

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
const domainLabel = computed(() =>
  domain.value ? (domainTitlesFor(currentCourseId.value)[domain.value] ?? domain.value) : "",
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
    :domain-label="domainLabel"
    title="Practice"
  />
</template>
