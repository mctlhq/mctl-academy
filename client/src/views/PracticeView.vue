<script setup lang="ts">
import { computed } from "vue";
import PracticeContent from "../practice/PracticeContent.vue";
import { useCourseStore } from "../services/courseStore";
import { questionsForCourse } from "../services/contentBundle";

// Course scoping happens here, before a session exists: PracticeContent (and
// the session engine underneath it) only ever sees one course's questions.
const { currentCourseId } = useCourseStore();
const bundle = computed(() => questionsForCourse(currentCourseId.value));
</script>

<template>
  <PracticeContent :key="currentCourseId ?? 'no-course'" :bundle="bundle" title="Practice" />
</template>
