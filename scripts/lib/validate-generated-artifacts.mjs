/**
 * Output contract for the two generated client artefacts.
 *
 * This is deliberately NOT a second copy of the source schema checks. The
 * JSON Schema in content/schemas/ and the lint in scripts/validate-content.mjs
 * prove that the *inputs* (content/questions/*.yaml, content/courses/*.yaml)
 * are well-formed. This function proves that what
 * scripts/build-content-bundle.mjs actually *emitted* is internally
 * consistent — which is a different failure mode: a refactor of the builder
 * that stops populating `publishedQuestionCount`, drops `course_id` from the
 * projection, or leaves `available` stale would sail past every source-side
 * check and ship a broken artefact to the client.
 *
 * It also underwrites the one cast the client still makes. Both
 * client/src/services/contentBundle.ts and courseCatalog.ts assert the
 * imported JSON into their declared TypeScript types; TypeScript cannot see
 * that the file on disk matches, and the client deliberately has no runtime
 * validator (see CLAUDE.md — no runtime check exists, or should be added).
 * Running this at the build boundary is what makes those casts true rather
 * than hopeful, in particular the narrowing of an option id from `string` to
 * the `"a" | "b" | "c" | "d"` union.
 *
 * Pure by design: it takes the two already-built structures and returns a
 * list of problems, so tests can feed it deliberately malformed artefacts
 * without touching the filesystem or shelling out to a build.
 */

const OPTION_IDS = ["a", "b", "c", "d"];

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateBundleQuestion(question, index, errors) {
  const at = `bundle[${index}]`;

  if (question === null || typeof question !== "object" || Array.isArray(question)) {
    errors.push(`${at}: expected an object, got ${Array.isArray(question) ? "array" : typeof question}`);
    return;
  }

  for (const field of ["id", "course_id", "domain", "objective", "stem"]) {
    if (!isNonEmptyString(question[field])) {
      errors.push(`${at}.${field}: expected a non-empty string, got ${JSON.stringify(question[field])}`);
    }
  }

  // Both fields are emitted unconditionally by the builder and are what the
  // learner sees as answer feedback. Optional validation here would let a
  // builder regression that drops them pass silently — the regeneration diff
  // in CI compares committed bytes against a fresh build, so both sides would
  // agree and nothing would fail.
  if (!isNonEmptyString(question.objectiveTitle)) {
    errors.push(`${at}.objectiveTitle: expected a non-empty string`);
  }
  if (!Array.isArray(question.sources) || question.sources.length === 0) {
    errors.push(`${at}.sources: expected a non-empty array`);
  } else {
    for (const source of question.sources) {
      if (!source || !isNonEmptyString(source.title) || !isNonEmptyString(source.excerpt)) {
        errors.push(`${at}.sources: title and excerpt are required`);
      }
      try {
        const url = new URL(source?.url);
        if (
          url.protocol !== "https:" ||
          !["docs.nebius.com", "docs.tokenfactory.nebius.com"].includes(url.hostname) ||
          url.username ||
          url.password
        ) {
          errors.push(`${at}.sources: expected an allowlisted HTTPS documentation URL`);
        }
      } catch {
        errors.push(`${at}.sources: invalid URL`);
      }
      if (typeof source?.excerpt === "string" && source.excerpt.trim().split(/\s+/).length > 25) {
        errors.push(`${at}.sources: excerpt exceeds 25 words`);
      }
    }
  }

  if (!Array.isArray(question.options)) {
    errors.push(`${at}.options: expected an array, got ${typeof question.options}`);
    return;
  }

  // Four options is the schema's rule, restated here because the *client*
  // renders a fixed four-option layout: an artefact carrying three or five
  // would render wrong rather than merely be unusual content.
  if (question.options.length !== OPTION_IDS.length) {
    errors.push(`${at}.options: expected ${OPTION_IDS.length} options, got ${question.options.length}`);
  }

  const seenOptionIds = new Set();
  let correctCount = 0;

  question.options.forEach((option, optionIndex) => {
    const optionAt = `${at}.options[${optionIndex}]`;

    if (option === null || typeof option !== "object" || Array.isArray(option)) {
      errors.push(`${optionAt}: expected an object`);
      return;
    }

    // The narrowing the client's type declaration relies on. Anything outside
    // this set would make `BundleOption.id: OptionId` a lie.
    if (!OPTION_IDS.includes(option.id)) {
      errors.push(
        `${optionAt}.id: expected one of ${OPTION_IDS.join("/")}, got ${JSON.stringify(option.id)}`,
      );
    } else if (seenOptionIds.has(option.id)) {
      errors.push(`${optionAt}.id: duplicate option id ${JSON.stringify(option.id)} within this question`);
    } else {
      seenOptionIds.add(option.id);
    }

    for (const field of ["text", "explanation"]) {
      if (!isNonEmptyString(option[field])) {
        errors.push(`${optionAt}.${field}: expected a non-empty string`);
      }
    }

    if (typeof option.correct !== "boolean") {
      errors.push(`${optionAt}.correct: expected a boolean, got ${typeof option.correct}`);
    } else if (option.correct) {
      correctCount += 1;
    }
  });

  // Zero correct answers makes the question unanswerable; more than one makes
  // scoring arbitrary. Both are silent in the UI, which is why this is worth
  // failing the build over.
  if (correctCount !== 1) {
    errors.push(`${at}.options: expected exactly one correct option, got ${correctCount}`);
  }
}

function validateCatalogCourse(course, index, errors) {
  const at = `catalog[${index}]`;

  if (course === null || typeof course !== "object" || Array.isArray(course)) {
    errors.push(`${at}: expected an object`);
    return;
  }

  for (const field of ["id", "title"]) {
    if (!isNonEmptyString(course[field])) {
      errors.push(`${at}.${field}: expected a non-empty string, got ${JSON.stringify(course[field])}`);
    }
  }

  if (!isNonNegativeInteger(course.publishedQuestionCount)) {
    errors.push(
      `${at}.publishedQuestionCount: expected a non-negative integer, got ${JSON.stringify(course.publishedQuestionCount)}`,
    );
  }

  if (typeof course.available !== "boolean") {
    errors.push(`${at}.available: expected a boolean, got ${typeof course.available}`);
    // `available` drives whether a course can be selected at all, so a
    // non-boolean here is not something to reason further about.
  } else if (isNonNegativeInteger(course.publishedQuestionCount)) {
    // The catalog's own coherence rule: a course is selectable exactly when
    // it has published questions. Drift between these two fields is how a
    // learner ends up able to start a session with an empty bank.
    const expected = course.publishedQuestionCount > 0;
    if (course.available !== expected) {
      errors.push(
        `${at}.available: expected ${expected} for publishedQuestionCount ${course.publishedQuestionCount}, got ${course.available}`,
      );
    }
  }

  const mock = course.mock;
  if (mock === null || typeof mock !== "object" || Array.isArray(mock)) {
    errors.push(`${at}.mock: expected an object`);
    return;
  }

  for (const field of ["questionCount", "timeLimitMinutes"]) {
    if (!isNonNegativeInteger(mock[field])) {
      errors.push(`${at}.mock.${field}: expected a non-negative integer, got ${JSON.stringify(mock[field])}`);
    }
  }

  if (typeof mock.discloseBankSize !== "boolean") {
    errors.push(`${at}.mock.discloseBankSize: expected a boolean, got ${typeof mock.discloseBankSize}`);
  }

  if (!Array.isArray(mock.domains)) {
    errors.push(`${at}.mock.domains: expected an array`);
    return;
  }

  const seenDomainIds = new Set();
  let mockQuestionSum = 0;
  let everyDomainCountValid = true;

  mock.domains.forEach((domain, domainIndex) => {
    const domainAt = `${at}.mock.domains[${domainIndex}]`;

    if (domain === null || typeof domain !== "object" || Array.isArray(domain)) {
      errors.push(`${domainAt}: expected an object`);
      everyDomainCountValid = false;
      return;
    }

    for (const field of ["id", "title"]) {
      if (!isNonEmptyString(domain[field])) {
        errors.push(
          `${domainAt}.${field}: expected a non-empty string, got ${JSON.stringify(domain[field])}`,
        );
      }
    }

    // Two domains sharing an id inside one course would make domain-scoped
    // progress and mock composition ambiguous — the second silently wins in
    // any id-keyed lookup.
    if (isNonEmptyString(domain.id)) {
      if (seenDomainIds.has(domain.id)) {
        errors.push(`${domainAt}.id: duplicate domain id ${JSON.stringify(domain.id)} within course`);
      } else {
        seenDomainIds.add(domain.id);
      }
    }

    if (typeof domain.weight !== "number" || !Number.isFinite(domain.weight)) {
      errors.push(`${domainAt}.weight: expected a finite number, got ${JSON.stringify(domain.weight)}`);
    }

    if (!isNonNegativeInteger(domain.mockQuestions)) {
      errors.push(
        `${domainAt}.mockQuestions: expected a non-negative integer, got ${JSON.stringify(domain.mockQuestions)}`,
      );
      everyDomainCountValid = false;
    } else {
      mockQuestionSum += domain.mockQuestions;
    }
  });

  // The mock builder draws `mockQuestions` per domain and promises a
  // `questionCount`-long exam. If these disagree the exam is quietly the
  // wrong length — checked only when every part is individually sane, so a
  // single bad domain doesn't also produce a confusing sum error.
  if (
    everyDomainCountValid &&
    isNonNegativeInteger(mock.questionCount) &&
    mockQuestionSum !== mock.questionCount
  ) {
    errors.push(
      `${at}.mock: domain mockQuestions sum to ${mockQuestionSum}, but questionCount is ${mock.questionCount}`,
    );
  }
}

/**
 * Validates the generated bundle and catalog against each other.
 *
 * @param {unknown} bundle  parsed client/src/content-bundle.json
 * @param {unknown} catalog parsed client/src/course-catalog.json
 * @returns {string[]} human-readable problems; empty means the pair is valid
 */
export function validateGeneratedArtifacts(bundle, catalog) {
  const errors = [];

  // Nothing below can be checked meaningfully without both shapes, so the two
  // shape checks and their shared early return live in one block: it keeps
  // the "both are arrays from here on" guarantee visible at the point it is
  // established, rather than resting on `errors` being empty further down.
  if (!Array.isArray(bundle) || !Array.isArray(catalog)) {
    if (!Array.isArray(bundle)) {
      errors.push(`bundle: expected an array, got ${typeof bundle}`);
    }
    if (!Array.isArray(catalog)) {
      errors.push(`catalog: expected an array, got ${typeof catalog}`);
    }
    return errors;
  }

  bundle.forEach((question, index) => validateBundleQuestion(question, index, errors));
  catalog.forEach((course, index) => validateCatalogCourse(course, index, errors));

  const seenQuestionIds = new Set();
  for (const question of bundle) {
    const id = question?.id;
    if (!isNonEmptyString(id)) continue;
    // Question ids key attempts, votes and reports on the server. A duplicate
    // would merge two different questions' learner history.
    if (seenQuestionIds.has(id)) {
      errors.push(`bundle: duplicate question id ${JSON.stringify(id)}`);
    }
    seenQuestionIds.add(id);
  }

  const coursesById = new Map();
  for (const course of catalog) {
    const id = course?.id;
    if (!isNonEmptyString(id)) continue;
    if (coursesById.has(id)) {
      errors.push(`catalog: duplicate course id ${JSON.stringify(id)}`);
      continue;
    }
    coursesById.set(id, course);
  }

  // Cross-artefact: every question must be reachable through a course the
  // catalog actually lists, and through a domain that course declares.
  // Otherwise the question exists in the bundle but nothing in the UI can
  // ever select it (unknown course) or attribute it (unknown domain).
  const publishedByCourse = new Map();
  bundle.forEach((question, index) => {
    const courseId = question?.course_id;
    if (!isNonEmptyString(courseId)) return;

    publishedByCourse.set(courseId, (publishedByCourse.get(courseId) ?? 0) + 1);

    const course = coursesById.get(courseId);
    if (!course) {
      errors.push(`bundle[${index}].course_id: ${JSON.stringify(courseId)} is not in the catalog`);
      return;
    }

    const domainId = question?.domain;
    if (!isNonEmptyString(domainId)) return;
    const domains = Array.isArray(course.mock?.domains) ? course.mock.domains : [];
    if (!domains.some((d) => d?.id === domainId)) {
      errors.push(
        `bundle[${index}].domain: ${JSON.stringify(domainId)} is not a domain of course ${JSON.stringify(courseId)}`,
      );
    }
  });

  // The count the catalog advertises must be the count the bundle actually
  // carries — this is the number the UI shows as the bank size and the one
  // `available` is derived from.
  for (const [courseId, course] of coursesById) {
    if (!isNonNegativeInteger(course.publishedQuestionCount)) continue;
    const actual = publishedByCourse.get(courseId) ?? 0;
    if (course.publishedQuestionCount !== actual) {
      errors.push(
        `catalog course ${JSON.stringify(courseId)}: publishedQuestionCount is ${course.publishedQuestionCount}, but the bundle carries ${actual} question(s)`,
      );
    }
  }

  return errors;
}
