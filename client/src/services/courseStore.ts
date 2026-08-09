import { ref, computed } from "vue";

export interface CourseInfo {
  id: string;
  name: string;
  shortName: string;
}

/**
 * Client-side course store managing active course selection.
 * Names follow generic domain naming per branding rules (no vendor branding in code).
 */
export const COURSES: CourseInfo[] = [
  { id: "agentic-ai-builder", name: "Agentic AI Builder", shortName: "Agentic AI Builder" },
  { id: "ai-cloudops-engineer", name: "AI CloudOps Engineer", shortName: "AI CloudOps Engineer" },
  { id: "ai-leader", name: "AI Leader", shortName: "AI Leader" },
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
  return COURSES[0].id;
}

const currentCourseId = ref<string>(getInitialCourseId());

export function useCourseStore() {
  const currentCourse = computed(
    () => COURSES.find((c) => c.id === currentCourseId.value) || COURSES[0],
  );

  function setCourse(courseId: string) {
    if (COURSES.some((c) => c.id === courseId)) {
      currentCourseId.value = courseId;
      try {
        localStorage.setItem(STORAGE_KEY, courseId);
      } catch {
        // Ignore
      }
    }
  }

  return {
    courses: COURSES,
    currentCourseId,
    currentCourse,
    setCourse,
  };
}
