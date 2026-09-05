<script setup lang="ts">
import { useRouter } from "vue-router";
import DashboardScreen from "../dashboard/DashboardScreen.vue";

const router = useRouter();
</script>

<template>
  <DashboardScreen
    :on-review-mistakes="() => router.push('/mistakes')"
    :on-start-practice="(domain) => router.push({ path: '/practice', query: domain ? { domain } : {} })"
  />
</template>
