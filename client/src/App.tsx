import { PracticeScreen } from "./practice/PracticeScreen";

// Practice mode is the only screen this proposal builds — Mock, Review
// mistakes, and the progress dashboard are separate product modes tracked
// elsewhere (requirements.md "Out of scope"). App is a thin root so a
// router can be introduced later without touching PracticeScreen itself.
export function App() {
  return <PracticeScreen />;
}
