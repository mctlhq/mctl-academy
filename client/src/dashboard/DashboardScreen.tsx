import { useState } from "react";
import { calculateProgressStats, clearProgress } from "../services/progressStore";
import "./DashboardScreen.css";

interface DashboardScreenProps {
  onReviewMistakes: () => void;
  onStartPractice: () => void;
}

export function DashboardScreen({ onReviewMistakes, onStartPractice }: DashboardScreenProps) {
  const [stats, setStats] = useState(() => calculateProgressStats());

  const handleClearHistory = () => {
    if (window.confirm("Are you sure you want to clear your learning progress and mistake history?")) {
      clearProgress();
      setStats(calculateProgressStats());
    }
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h2>Learner Progress & Mastery Dashboard</h2>
        <p className="dashboard-subtitle">
          Track your overall performance and domain-by-domain readiness across the 4 exam domains.
        </p>
      </div>

      <div className="stats-cards-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.overallAccuracy}%</div>
          <div className="stat-label">Overall Accuracy</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">
            {stats.totalAttempted} / {stats.totalBankQuestions}
          </div>
          <div className="stat-label">Questions Attempted</div>
        </div>

        <div className="stat-card">
          <div className="stat-value text-warning">{stats.totalMistakes}</div>
          <div className="stat-label">Reviewable Mistakes</div>
        </div>
      </div>

      <div className="dashboard-actions">
        {stats.totalMistakes > 0 ? (
          <button className="btn btn-primary" onClick={onReviewMistakes}>
            Review Mistakes ({stats.totalMistakes})
          </button>
        ) : (
          <button className="btn btn-secondary" onClick={onStartPractice}>
            Start Full Practice Bank
          </button>
        )}
        <button className="btn btn-outline-danger" onClick={handleClearHistory}>
          Reset Progress History
        </button>
      </div>

      <div className="domain-breakdown-section">
        <h3>Domain Mastery Breakdown</h3>
        <div className="domain-cards-list">
          {stats.domainProgress.map((domain) => (
            <div className="domain-card" key={domain.domainId}>
              <div className="domain-card-header">
                <h4>{domain.domainTitle}</h4>
                <span className="domain-accuracy-badge">{domain.accuracy}% Accuracy</span>
              </div>

              <div className="progress-bar-track">
                <div
                  className="progress-bar-fill"
                  style={{
                    width: `${domain.accuracy}%`,
                    backgroundColor:
                      domain.accuracy >= 80 ? "#2e7d32" : domain.accuracy >= 60 ? "#ed6c02" : "#d32f2f",
                  }}
                />
              </div>

              <div className="domain-card-meta">
                <span>
                  Attempted: {domain.attemptedQuestions} / {domain.totalQuestions} questions
                </span>
                <span>Correct: {domain.correctQuestions}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
