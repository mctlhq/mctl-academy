import { useState } from "react";
import { PracticeScreen } from "./practice/PracticeScreen";
import { MockFlow } from "./exam/components/MockFlow";
import { StaticBundleDataSource } from "./exam/dataSource";

const dataSource = new StaticBundleDataSource();

export function App() {
  const [mode, setMode] = useState<"practice" | "exam">("practice");

  return (
    <main className="app">
      <nav style={{ display: "flex", gap: "1rem", padding: "1rem", borderBottom: "1px solid #ccc", marginBottom: "1rem" }}>
        <button
          onClick={() => setMode("practice")}
          style={{ fontWeight: mode === "practice" ? "bold" : "normal", padding: "0.5rem 1rem", cursor: "pointer" }}
        >
          Practice Mode
        </button>
        <button
          onClick={() => setMode("exam")}
          style={{ fontWeight: mode === "exam" ? "bold" : "normal", padding: "0.5rem 1rem", cursor: "pointer" }}
        >
          Mock Exam (30 Questions)
        </button>
      </nav>
      {mode === "practice" ? <PracticeScreen /> : <MockFlow dataSource={dataSource} />}
    </main>
  );
}

