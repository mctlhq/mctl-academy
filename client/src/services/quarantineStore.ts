import { ref } from "vue";

const quarantinedIdsRef = ref<Set<string>>(new Set());
const loadedRef = ref<boolean>(false);
const errorRef = ref<string | null>(null);
let fetchPromise: Promise<Set<string>> | null = null;

export function useQuarantineStore() {
  async function fetchQuarantinedIds(): Promise<Set<string>> {
    if (loadedRef.value) return quarantinedIdsRef.value;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
      try {
        errorRef.value = null;
        const res = await fetch("/api/quarantine");
        if (!res.ok) {
          throw new Error(`Quarantine API returned status ${res.status}`);
        }
        const data = await res.json();
        if (data.success && Array.isArray(data.quarantinedQuestionIds)) {
          quarantinedIdsRef.value = new Set(data.quarantinedQuestionIds);
          loadedRef.value = true;
        } else {
          throw new Error("Invalid response format from quarantine API");
        }
      } catch (err: any) {
        errorRef.value = err?.message || "Failed to fetch quarantine list";
        console.warn("[quarantineStore] Could not load quarantine status:", errorRef.value);
      } finally {
        fetchPromise = null;
      }
      return quarantinedIdsRef.value;
    })();

    return fetchPromise;
  }

  function isQuarantined(questionId: string): boolean {
    return quarantinedIdsRef.value.has(questionId);
  }

  return {
    quarantinedIds: quarantinedIdsRef,
    isLoaded: loadedRef,
    error: errorRef,
    fetchQuarantinedIds,
    isQuarantined,
  };
}
