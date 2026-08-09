import { ref } from "vue";

const quarantinedIdsRef = ref<Set<string>>(new Set());
const loadedRef = ref<boolean>(false);

export function useQuarantineStore() {
  async function fetchQuarantinedIds(): Promise<Set<string>> {
    if (loadedRef.value) return quarantinedIdsRef.value;
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
      // Network/server errors: do not set loadedRef to true, so subsequent calls can retry
    }
    return quarantinedIdsRef.value;
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
