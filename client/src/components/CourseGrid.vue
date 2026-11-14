<script setup lang="ts">
import CourseCard from "./CourseCard.vue";
import type { CourseInfo } from "../services/courseCatalog";

defineProps<{
  courses: readonly CourseInfo[];
  /** Marks this course's card as the one being studied. */
  currentCourseId?: string | null;
}>();
</script>

<template>
  <ul class="course-grid" role="list">
    <li v-for="course in courses" :key="course.id">
      <CourseCard :course="course" :current="course.id === currentCourseId" />
    </li>
  </ul>
</template>

<style scoped>
.course-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 16.5rem), 1fr));
  gap: 1.25rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.course-grid > li {
  display: flex;
  min-width: 0;
}

.course-grid > li > * {
  flex: 1 1 auto;
}

@media (max-width: 560px) {
  .course-grid {
    gap: 0.75rem;
  }
}
</style>
