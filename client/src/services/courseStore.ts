import { ref, computed } from "vue";

export interface CourseInfo {
  id: string;
  name: string;
  shortName: string;
}

/**
 * Client-side course store managing the active certification course selection.
 * Selection is stored in reactive state and persisted in localStorage.
 */
export const COURSES: CourseInfo[] = [
  { id: "agentic-ai-builder", name: "Nebius Agentic AI Builder", shortName: "Agentic AI Builder" },
  { id: "ai-cloudops-engineer", name: "Nebius AI CloudOps Engineer", shortName: "AI CloudOps Engineer" },
  { id: "ai-leader", name: "Nebius AI Leader", shortName: "AI Leader" },
];

const STORAGE_KEY = "mctl_academy_course_id";

function getInitialCourseId(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && COURSES.some((c) => c.id === saved)) {
      return saved;
    }
  } catch {
    // Ignore storage errors
  }
  return "agentic-ai-builder";
}

const currentCourseIdRef = ref<string>(getInitialCourseId());

export function useCourseStore() {
  const currentCourseId = computed(() => currentCourseIdRef.value);

  const currentCourse = computed(
    () => COURSES.find((c) => c.id === currentCourseIdRef.value) || COURSES[0],
  );

  function setCourse(courseId: string) {
    if (!COURSES.some((c) => c.id === courseId)) return;
    currentCourseIdRef.value = courseId;
    try {
      localStorage.setItem(STORAGE_KEY, courseId);
    } catch {
      // Ignore storage errors
    }
  }

  return {
    courses: COURSES,
    currentCourseId,
    currentCourse,
    setCourse,
  };
}
