<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { MButton, MCard, MPill } from "@mctlhq/ui";
import type { CourseInfo } from "../services/courseCatalog";
import { glyphFor } from "./courseGlyphs";

const props = defineProps<{
  course: CourseInfo;
  /** The course the learner has selected in the header switcher. */
  current?: boolean;
}>();

const glyph = computed(() => glyphFor(props.course.id));
const titleId = computed(() => `course-card-${props.course.id}`);
// Practice goes through the router's ?course= deep link, which selects the
// course (only when it is available) and strips the parameter, so a card for
// a course other than the selected one opens that course's bank.
const practicePath = computed(() => `/practice?course=${encodeURIComponent(props.course.id)}`);
const coursePath = computed(() => `/courses/${encodeURIComponent(props.course.id)}`);
</script>

<template>
  <MCard
    as="article"
    font="sans"
    interactive
    class="course-card"
    :style="{ '--course-hue': `var(${glyph.hue})` }"
    :aria-labelledby="titleId"
    data-testid="course-card"
    :data-course-id="course.id"
  >
    <template #media>
      <svg class="course-card-glyph" viewBox="0 0 96 64" aria-hidden="true" focusable="false">
        <component :is="shape.tag" v-for="(shape, i) in glyph.shapes" :key="i" v-bind="shape.attrs" />
      </svg>
    </template>

    <div class="course-card-pills">
      <MPill v-if="course.available" tone="ok" variant="outline">Available</MPill>
      <MPill v-else tone="neutral" variant="outline">Coming soon</MPill>
      <MPill v-if="current" tone="accent">Studying now</MPill>
    </div>
    <h3 :id="titleId" class="course-card-title">{{ course.title }}</h3>
    <p v-if="course.summary" class="course-card-summary">{{ course.summary }}</p>
    <p v-if="course.available" class="course-card-meta">
      {{ course.publishedQuestionCount }} questions · {{ course.mock.timeLimitMinutes }} min mock
    </p>

    <template #actions>
      <MButton
        v-if="course.available"
        :as="RouterLink"
        :to="practicePath"
        variant="neutral"
        size="sm"
        :aria-label="`Practice ${course.title}`"
        >Practice</MButton
      >
      <MButton
        v-else
        variant="neutral"
        size="sm"
        disabled
        :aria-label="`Practice ${course.title}, coming soon`"
        >Practice</MButton
      >
      <MButton
        :as="RouterLink"
        :to="coursePath"
        variant="ghost"
        size="sm"
        :aria-label="`${course.title} course page`"
        >Course page</MButton
      >
    </template>
  </MCard>
</template>

<style scoped>
.course-card {
  display: flex;
  flex-direction: column;
}

/* MCard's body is the middle slot; let it grow so the action rows of a grid
   line up whatever the summary length. */
.course-card :deep(.m-card__body) {
  flex: 1 1 auto;
}

/* The banner: an original line glyph on a gradient made only from design
   tokens (the course hue mixed into the card surface), so it follows the
   theme and carries no vendor colour or artwork (LEGAL.md). */
.course-card-glyph {
  height: 5.5rem;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--surface-line);
  background:
    radial-gradient(
      circle at 78% 30%,
      color-mix(in srgb, var(--course-hue, var(--accent)) 26%, transparent),
      transparent 60%
    ),
    linear-gradient(
      135deg,
      color-mix(in srgb, var(--course-hue, var(--accent)) 14%, var(--surface-card)),
      var(--surface-card)
    );
  color: var(--course-hue, var(--accent));
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 2.2;
}

.course-card-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-bottom: 0.6rem;
}

.course-card-title {
  margin: 0 0 0.4rem;
  color: var(--surface-fg);
  font-size: 1.05rem;
  font-weight: 600;
  line-height: 1.3;
}

.course-card-summary {
  margin: 0 0 0.6rem;
  color: var(--surface-fg-muted);
  font-size: 0.9rem;
  line-height: 1.45;
}

.course-card-meta {
  margin: 0;
  color: var(--surface-fg-subtle);
  font-family: var(--font-mono);
  font-size: var(--text-caption-size);
}

/* 44px touch targets through tablet width, like the rest of the app. */
@media (max-width: 980px) {
  .course-card :deep(.m-card__actions .m-button) {
    min-height: 2.75rem;
  }
}
</style>
