<script setup lang="ts">
import { onMounted, ref } from "vue";
import { courseCatalog } from "../services/courseCatalog";

interface AdminStats {
  totalSignups: number;
  totalSessions: number;
  totalAttempts: number;
  accuracy: number;
  anonymousAttempts: number;
}

const stats = ref<AdminStats | null>(null);
const loading = ref(true);

const totalBankQuestions = courseCatalog.reduce((sum, course) => sum + course.publishedQuestionCount, 0);

// No client-side "am I admin" check, deliberately — GET /api/admin/stats is
// the only gate (same 404-for-everyone-else pattern as /api/reports). A
// client-side check here would just be UI polish, not a real second layer.
onMounted(async () => {
  try {
    const res = await fetch("/api/admin/stats", { credentials: "same-origin" });
    if (res.ok) {
      stats.value = await res.json();
    }
  } catch {
    // stats stays null — treated the same as a non-200 response below.
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <section class="admin-stats page-shell">
    <div v-if="loading">Loading…</div>
    <div v-else-if="!stats">Not available.</div>
    <dl v-else class="admin-stats-grid">
      <div>
        <dt>Total sign-ups</dt>
        <dd>{{ stats.totalSignups }}</dd>
      </div>
      <div>
        <dt>Questions in bank</dt>
        <dd>{{ totalBankQuestions }}</dd>
      </div>
      <div>
        <dt>Sessions</dt>
        <dd>{{ stats.totalSessions }}</dd>
      </div>
      <div>
        <dt>Attempts logged</dt>
        <dd>{{ stats.totalAttempts }}</dd>
      </div>
      <div>
        <dt>Accuracy</dt>
        <dd>{{ Math.round(stats.accuracy * 100) }}%</dd>
      </div>
      <div>
        <dt>Anonymous attempts</dt>
        <dd>{{ stats.anonymousAttempts }}</dd>
      </div>
    </dl>
  </section>
</template>

<style scoped>
.admin-stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
  gap: 1rem;
}

.admin-stats-grid dt {
  font-size: 0.875rem;
  opacity: 0.7;
}

.admin-stats-grid dd {
  font-size: 1.75rem;
  font-weight: 600;
  margin: 0;
}
</style>
