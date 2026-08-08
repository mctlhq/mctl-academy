<script setup lang="ts">
import MockFlow from "../exam/components/MockFlow.vue";
import { StaticBundleDataSource } from "../exam/dataSource";

const dataSource = new StaticBundleDataSource();
</script>

<template>
  <MockFlow :data-source="dataSource" />
</template>
