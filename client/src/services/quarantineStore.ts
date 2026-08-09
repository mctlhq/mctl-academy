import { ref } from "vue";

const quarantinedIdsRef = ref<Set<string>>(new Set());
const loadedRef = ref<boolean>(false);
let fetchPromise: Promise<Set<string>> | null = null;

export function useQuarantineStore() {
  async function fetchQuarantinedIds(): Promise<Set<string>> {
    if (loadedRef.value) return quarantinedIdsRef.value;
    if (fetchPromise) return fetchPromise;

    fetchPromise = (async () => {
      try {
        const res = await fetch("/api/quarantine");
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.quarantinedQuestionIds)) {
            quarantinedIdsRef.value = new Set(data.quarantinedQuestionIds);
            loadedRef.value = true;
          }
        }
      } catch {
        // Network/server errors: fetchPromise resets so callers can retry later
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
    fetchQuarantinedIds,
    isQuarantined,
  };
}
