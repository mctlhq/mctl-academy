<script setup lang="ts">
import PracticeScreen from "../practice/PracticeScreen.vue";
import { getMistakeQuestionIds } from "../services/progressStore";
import rawBundle from "../content-bundle.json";
import type { BundleQuestion } from "../practice/usePracticeSession";

const fullBundle = rawBundle as unknown as BundleQuestion[];
const mistakeIds = new Set(getMistakeQuestionIds());
const mistakesBundle = fullBundle.filter((q) => mistakeIds.has(q.id));
</script>

<template>
  <PracticeScreen
    :bundle="mistakesBundle"
    title="Review Mistakes"
    empty-message="You have no recorded mistakes! Practice questions to log areas for review."
  />
</template>
