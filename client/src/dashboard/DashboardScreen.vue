<script setup lang="ts">
import { ref } from "vue";
import { MStat, MCard, MButton } from "@mctlhq/ui";
import { calculateProgressStats, clearProgress } from "../services/progressStore";

defineProps<{
  onReviewMistakes: () => void;
  onStartPractice: () => void;
}>();

const stats = ref(calculateProgressStats());

function handleClearHistory() {
  if (window.confirm("Are you sure you want to clear your learning progress and mistake history?")) {
    clearProgress();
    stats.value = calculateProgressStats();
  }
}

function accuracyTone(accuracy: number): string {
  if (accuracy >= 80) return "var(--status-ok)";
  if (accuracy >= 60) return "var(--status-warn)";
  return "var(--status-bad)";
}
</script>

<template>
  <div class="dashboard-container">
    <div class="dashboard-header">
      <h2>Learner Progress &amp; Mastery Dashboard</h2>
      <p class="dashboard-subtitle">
        Track your overall performance and domain-by-domain readiness across the 4 exam domains.
      </p>
    </div>

    <div class="stats-cards-grid">
      <MStat :value="`${stats.overallAccuracy}%`" label="Overall Accuracy" />
      <MStat :value="`${stats.totalAttempted} / ${stats.totalBankQuestions}`" label="Questions Attempted" />
      <MStat :value="String(stats.totalMistakes)" label="Reviewable Mistakes" />
    </div>

    <div class="dashboard-actions">
      <MButton v-if="stats.totalMistakes > 0" type="button" @click="onReviewMistakes">
        Review Mistakes ({{ stats.totalMistakes }})
      </MButton>
      <MButton v-else type="button" variant="ghost" @click="onStartPractice">
        Start Full Practice Bank
      </MButton>
      <MButton type="button" variant="ghost" class="btn-outline-danger" @click="handleClearHistory">
        Reset Progress History
      </MButton>
    </div>

    <div class="domain-breakdown-section">
      <h3>Domain Mastery Breakdown</h3>
      <div class="domain-cards-list">
        <MCard v-for="domain in stats.domainProgress" :key="domain.domainId">
          <template #header>
            <span class="domain-card-header">
              {{ domain.domainTitle }}
              <span class="domain-accuracy-badge">{{ domain.accuracy }}% Accuracy</span>
            </span>
          </template>

          <div class="progress-bar-track">
            <div
              class="progress-bar-fill"
              :style="{ width: `${domain.accuracy}%`, backgroundColor: accuracyTone(domain.accuracy) }"
            />
          </div>

          <div class="domain-card-meta">
            <span>Attempted: {{ domain.attemptedQuestions }} / {{ domain.totalQuestions }} questions</span>
            <span>Correct: {{ domain.correctQuestions }}</span>
          </div>
        </MCard>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dashboard-container {
  max-width: 900px;
  margin: 0 auto;
}

.dashboard-header {
  margin-bottom: 2rem;
  border-bottom: 1px solid var(--surface-line);
  padding-bottom: 1rem;
}

.dashboard-header h2 {
  margin: 0 0 0.5rem 0;
  font-size: 1.75rem;
}

.dashboard-subtitle {
  margin: 0;
  color: var(--surface-fg-muted);
  font-size: 0.95rem;
}

.stats-cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 1rem;
  margin-bottom: 2rem;
}

.dashboard-actions {
  display: flex;
  gap: 1rem;
  margin-bottom: 2.5rem;
  flex-wrap: wrap;
}

.btn-outline-danger {
  border-color: var(--status-bad) !important;
  color: var(--status-bad) !important;
}

.domain-breakdown-section h3 {
  margin-top: 0;
  margin-bottom: 1.25rem;
}

.domain-cards-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.domain-card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
}

.domain-accuracy-badge {
  font-size: 0.85rem;
  font-weight: 600;
  background: var(--surface-elevated);
  padding: 0.25rem 0.6rem;
  border-radius: 12px;
}

.progress-bar-track {
  height: 8px;
  background: var(--surface-line);
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 0.75rem;
}

.progress-bar-fill {
  height: 100%;
  transition: width 0.3s ease;
}

.domain-card-meta {
  display: flex;
  justify-content: space-between;
  font-size: 0.85rem;
  color: var(--surface-fg-muted);
}
</style>
