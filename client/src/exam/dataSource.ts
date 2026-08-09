import type { MockConfig, Question } from "./types";
import { questionsForCourse } from "../services/contentBundle";
import { findCourse } from "../services/courseCatalog";

/**
 * Source of the mock exam's configuration and question bank. One
 * implementation exists today (StaticBundleDataSource, reading the
 * build-time-generated content/ artefacts). A future ApiDataSource hitting the
 * real API (PLAN.md section 7) is a drop-in replacement -- exam logic and
 * screens only ever depend on this interface, never on the bundle shape
 * directly.
 */
export interface ExamDataSource {
  getMockConfig(): Promise<MockConfig>;
  getQuestions(): Promise<Question[]>;
  /** Questions available in this course's bank, for disclose_bank_size. */
  getBankSize(): Promise<number>;
}

const EMPTY_MOCK: MockConfig = {
  questionCount: 0,
  timeLimitMinutes: 0,
  discloseBankSize: false,
  domains: [],
};

/**
 * The published bank and mock configuration for one course.
 *
 * Both come from canonical content: the questions from
 * client/src/content-bundle.json filtered by course_id, the configuration from
 * the course's own content/courses/<id>.yaml via the generated catalog. A mock
 * therefore cannot mix courses, and cannot inherit another course's question
 * count, time limit or domain weighting.
 */
export class StaticBundleDataSource implements ExamDataSource {
  constructor(private readonly courseId: string | null) {}

  async getMockConfig(): Promise<MockConfig> {
    return findCourse(this.courseId)?.mock ?? EMPTY_MOCK;
  }

  async getQuestions(): Promise<Question[]> {
    // The bundle types option ids as plain strings; the exam types narrow them
    // to "a" | "b" | "c" | "d", which content/schemas/question.schema.json
    // already enforces at build time.
    return questionsForCourse(this.courseId) as unknown as Question[];
  }

  async getBankSize(): Promise<number> {
    return questionsForCourse(this.courseId).length;
  }
}
