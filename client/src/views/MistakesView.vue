<script setup lang="ts">
import { computed, inject, type Ref } from "vue";
import PracticeContent from "../practice/PracticeContent.vue";
import { getMistakeQuestionIds } from "../services/progressStore";
import { questionsForCourse } from "../services/contentBundle";
import { useCourseStore } from "../services/courseStore";

/**
 * Review Mistakes is the intersection of two sets: the questions belonging to
 * the active course, and the question ids the learner got wrong. Attempts
 * carry no course of their own — course membership is content metadata, so
 * intersecting by id is what scopes this screen, and switching course
 * necessarily changes the scope.
 *
 * syncVersion is injected (not part of App.vue's remount key) so a
 * background sync merging in server-side mistakes refreshes this list
 * reactively instead of via a destructive remount.
 */
const { currentCourseId } = useCourseStore();
const syncVersion = inject<Ref<number>>("syncVersion");
const mistakesBundle = computed(() => {
  void syncVersion?.value;
  const mistakeIds = new Set(getMistakeQuestionIds());
  return questionsForCourse(currentCourseId.value).filter((q) => mistakeIds.has(q.id));
});
</script>

<template>
  <PracticeContent
    :key="currentCourseId ?? 'no-course'"
    :bundle="mistakesBundle"
    title="Review Mistakes"
    empty-message="You have no recorded mistakes in this course. Practice questions to log areas for review."
  />
</template>
