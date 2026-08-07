import type { MockConfig, Question } from "./types";
import bundle from "../data/mock-bundle.generated.json";

const typedBundle = bundle as {
  mock: MockConfig;
  bankSize: number;
  publishedBankSize: number;
  questions: Question[];
};

/**
 * Source of the mock exam's configuration and question bank. One
 * implementation exists today (StaticBundleDataSource, reading the
 * build-time-generated content/ bundle). A future ApiDataSource hitting the
 * real Express API (PLAN.md section 7) is a drop-in replacement -- exam
 * logic and screens only ever depend on this interface, never on the bundle
 * shape directly.
 */
export interface ExamDataSource {
  getMockConfig(): Promise<MockConfig>;
  getQuestions(): Promise<Question[]>;
  /** Total questions in the bank regardless of status, for disclose_bank_size. */
  getBankSize(): Promise<number>;
}

export class StaticBundleDataSource implements ExamDataSource {
  async getMockConfig(): Promise<MockConfig> {
    return typedBundle.mock;
  }

  async getQuestions(): Promise<Question[]> {
    return typedBundle.questions;
  }

  async getBankSize(): Promise<number> {
    return typedBundle.bankSize;
  }
}
