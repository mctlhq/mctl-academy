<script setup lang="ts">
import { computed, inject, type Ref } from "vue";
import PracticeContent from "../practice/PracticeContent.vue";
import { practiceStorageKey } from "../practice/usePracticeSession";
import type { UserProfile } from "../types/user";
import { questionsForCourse } from "../services/contentBundle";
import { useCourseStore } from "../services/courseStore";

/**
 * Review Mistakes is the intersection of two sets: the questions belonging to
 * the active course, and the question ids the learner got wrong. Attempts
 * carry no course of their own — course membership is content metadata, so
 * intersecting by id is what scopes this screen, and switching course
 * necessarily changes the scope.
 *
 * The session engine performs the mistakes intersection at start/resume/Next,
 * so a background result cannot replace an open question's feedback.
 */
const { currentCourseId } = useCourseStore();
const user = inject<Ref<UserProfile | null>>("currentUser");
const sessionKey = computed(() =>
  practiceStorageKey(user?.value?.id ?? null, currentCourseId.value ?? "", "mistakes"),
);
const mistakesBundle = computed(() => {
  return questionsForCourse(currentCourseId.value);
});
</script>

<template>
  <PracticeContent
    :key="sessionKey"
    :storage-key="sessionKey"
    mode="mistakes"
    :bundle="mistakesBundle"
    title="Review Mistakes"
    empty-message="You have no recorded mistakes in this course. Practice questions to log areas for review."
  />
</template>
