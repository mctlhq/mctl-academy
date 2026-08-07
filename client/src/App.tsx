import { MockFlow } from "./exam/components/MockFlow";
import { StaticBundleDataSource } from "./exam/dataSource";

// Single real route for now: the mock flow (issue #20). Learn / Practice /
// Review-mistakes are out of scope for this proposal -- see requirements.md.
const dataSource = new StaticBundleDataSource();

export function App() {
  return (
    <main className="app">
      <MockFlow dataSource={dataSource} />
    </main>
  );
}
