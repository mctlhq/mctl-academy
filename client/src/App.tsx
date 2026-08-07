import { useEffect, useMemo, useState } from "react";
import { PracticeScreen } from "./practice/PracticeScreen";
import { MockFlow } from "./exam/components/MockFlow";
import { DashboardScreen } from "./dashboard/DashboardScreen";
import { UserNav, type UserProfile } from "./components/UserNav";
import { StaticBundleDataSource } from "./exam/dataSource";
import { getMistakeQuestionIds, setSyncEnabled, syncFromServer } from "./services/progressStore";
import rawBundle from "./content-bundle.json";
import type { BundleQuestion } from "./practice/usePracticeSession";

const dataSource = new StaticBundleDataSource();
const fullBundle = rawBundle as unknown as BundleQuestion[];

export function App() {
  const [mode, setMode] = useState<"practice" | "mistakes" | "exam" | "dashboard">("practice");
  const [navTick, setNavTick] = useState(0);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/auth/me")
      .then((res) => res.json())
      .then(async (data) => {
        if (cancelled) return;

        if (data.authenticated && data.user) {
          setUser(data.user);
          setSyncEnabled(true);
          await syncFromServer();
          if (!cancelled) {
            // Local progress may have just been merged with server history;
            // recompute anything derived from it (mistake count, dashboard).
            setNavTick((n) => n + 1);
          }
        } else {
          setUser(null);
          setSyncEnabled(false);
        }
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const mistakeIds = useMemo(() => getMistakeQuestionIds(), [navTick, mode]);

  const mistakesBundle = useMemo(() => {
    const set = new Set(mistakeIds);
    return fullBundle.filter((q) => set.has(q.id));
  }, [mistakeIds]);

  const handleNav = (nextMode: "practice" | "mistakes" | "exam" | "dashboard") => {
    setNavTick((n) => n + 1);
    setMode(nextMode);
  };

  return (
    <main className="app">
      <nav
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "0.75rem",
          padding: "1rem",
          borderBottom: "1px solid #e0e0e0",
          marginBottom: "1.5rem",
          background: "#fafafa",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <button
            onClick={() => handleNav("practice")}
            style={{
              fontWeight: mode === "practice" ? "bold" : "normal",
              padding: "0.5rem 1rem",
              cursor: "pointer",
              background: mode === "practice" ? "#1976d2" : "#ffffff",
              color: mode === "practice" ? "#ffffff" : "#333333",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
          >
            Practice Bank
          </button>

          <button
            onClick={() => handleNav("mistakes")}
            style={{
              fontWeight: mode === "mistakes" ? "bold" : "normal",
              padding: "0.5rem 1rem",
              cursor: "pointer",
              background: mode === "mistakes" ? "#e65100" : "#ffffff",
              color: mode === "mistakes" ? "#ffffff" : "#333333",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
          >
            Review Mistakes ({mistakeIds.length})
          </button>

          <button
            onClick={() => handleNav("exam")}
            style={{
              fontWeight: mode === "exam" ? "bold" : "normal",
              padding: "0.5rem 1rem",
              cursor: "pointer",
              background: mode === "exam" ? "#2e7d32" : "#ffffff",
              color: mode === "exam" ? "#ffffff" : "#333333",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
          >
            Mock Exam (30 Questions)
          </button>

          <button
            onClick={() => handleNav("dashboard")}
            style={{
              fontWeight: mode === "dashboard" ? "bold" : "normal",
              padding: "0.5rem 1rem",
              cursor: "pointer",
              background: mode === "dashboard" ? "#4527a0" : "#ffffff",
              color: mode === "dashboard" ? "#ffffff" : "#333333",
              border: "1px solid #ccc",
              borderRadius: "4px",
            }}
          >
            Progress Dashboard
          </button>
        </div>

        <UserNav user={user} loading={authLoading} />
      </nav>

      {mode === "practice" && <PracticeScreen key={`practice-${navTick}`} />}

      {mode === "mistakes" && (
        <PracticeScreen
          key={`mistakes-${navTick}`}
          bundle={mistakesBundle}
          title="Review Mistakes"
          emptyMessage="You have no recorded mistakes! Practice questions to log areas for review."
        />
      )}

      {mode === "exam" && <MockFlow key={`exam-${navTick}`} dataSource={dataSource} />}

      {mode === "dashboard" && (
        <DashboardScreen
          onReviewMistakes={() => handleNav("mistakes")}
          onStartPractice={() => handleNav("practice")}
        />
      )}
    </main>
  );
}
