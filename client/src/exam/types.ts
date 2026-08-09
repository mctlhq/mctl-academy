// Shapes mirror content/schemas/question.schema.json and content/courses/*.yaml,
// as produced by scripts/build-content-bundle.mjs. The UI must not depend on
// any field the schema doesn't guarantee (e.g. `reviewed` is never assumed).

export type OptionId = "a" | "b" | "c" | "d";

export interface QuestionOption {
  id: OptionId;
  text: string;
  correct: boolean;
  explanation: string;
}

export interface Question {
  id: string;
  domain: string;
  objective: string;
  stem: string;
  options: QuestionOption[];
}

export interface DomainConfig {
  id: string;
  title: string;
  weight: number;
  mockQuestions: number;
}

export interface MockConfig {
  questionCount: number;
  timeLimitMinutes: number;
  discloseBankSize: boolean;
  domains: DomainConfig[];
}
