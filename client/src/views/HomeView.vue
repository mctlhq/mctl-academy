<script setup lang="ts">
import { useRouter } from "vue-router";
import HomeScreen from "../dashboard/HomeScreen.vue";

const router = useRouter();
</script>

<template>
  <HomeScreen
    :on-start-practice="() => router.push('/practice')"
    :on-review-mistakes="() => router.push('/mistakes')"
  />
</template>
