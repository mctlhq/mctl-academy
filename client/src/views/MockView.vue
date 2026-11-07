<script setup lang="ts">
import { computed } from "vue";
import MockFlow from "../exam/components/MockFlow.vue";
import { StaticBundleDataSource } from "../exam/dataSource";
import { useCourseStore } from "../services/courseStore";

// The mock draws from the selected course's bank and uses that course's own
// mock configuration. App.vue keys the routed view on the course id, so
// switching course abandons any in-progress mock rather than re-scoping it.
const { currentCourseId } = useCourseStore();
const dataSource = computed(() => new StaticBundleDataSource(currentCourseId.value));
</script>

<template>
  <MockFlow :data-source="dataSource" :course-id="currentCourseId ?? 'no-course'" />
</template>
