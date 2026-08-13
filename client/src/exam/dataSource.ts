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
    // No cast: BundleQuestion carries every field Question requires, with the
    // same narrowed option-id union, so it is structurally a Question (plus
    // `course_id`, which the exam simply ignores). The two types are kept
    // compatible by scripts/lib/validate-generated-artifacts.mjs failing the
    // build if the emitted bundle ever stops matching.
    return questionsForCourse(this.courseId);
  }

  async getBankSize(): Promise<number> {
    return questionsForCourse(this.courseId).length;
  }
}
