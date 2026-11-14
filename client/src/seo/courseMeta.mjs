/**
 * Head metadata for a course landing page (/courses/<id>), shared by the
 * client and the server.
 *
 * CourseView.vue applies these values to the live document after an in-app
 * navigation; server/spa.mjs injects the very same strings into index.html
 * before the response leaves the server, so crawlers and link previews see
 * the course rather than the home page. One module, so the two cannot drift.
 *
 * Plain .mjs (with a .d.mts beside it) because the server runs it as-is on
 * Bun/Node with no build step. Keep it pure: no DOM, no Node APIs.
 */

export const SITE_ORIGIN = "https://academy.mctl.ai";
export const SITE_NAME = "mctl academy";

/** The `<title>` the router gives a page: "Practice · mctl academy". */
export function pageTitle(title) {
  return typeof title === "string" && title ? `${title} · ${SITE_NAME}` : SITE_NAME;
}

export const COURSE_NOT_FOUND_TITLE = pageTitle("Course not found");
export const PAGE_NOT_FOUND_TITLE = pageTitle("Page not found");

/** Id of the JSON-LD `<script>` both sides write and CourseView later reuses. */
export const COURSE_JSONLD_ID = "schema-course-jsonld";

/**
 * The head tags a course page rewrites, and which field of courseHeadMeta()
 * feeds each one. The client builds a CSS selector from `tag` + `match`; the
 * server builds a regex from the same pair, so adding a row here updates both.
 */
export const COURSE_HEAD_TAGS = Object.freeze([
  { tag: "meta", match: ["name", "description"], attr: "content", field: "description" },
  { tag: "link", match: ["rel", "canonical"], attr: "href", field: "canonicalUrl" },
  { tag: "meta", match: ["property", "og:title"], attr: "content", field: "title" },
  { tag: "meta", match: ["property", "og:description"], attr: "content", field: "description" },
  { tag: "meta", match: ["property", "og:url"], attr: "content", field: "canonicalUrl" },
  { tag: "meta", match: ["name", "twitter:title"], attr: "content", field: "title" },
  { tag: "meta", match: ["name", "twitter:description"], attr: "content", field: "description" },
]);

export function headTagSelector(spec) {
  return `${spec.tag}[${spec.match[0]}="${spec.match[1]}"]`;
}

export function courseCanonicalUrl(courseId) {
  return `${SITE_ORIGIN}/courses/${courseId}`;
}

/**
 * Title, description, canonical URL and JSON-LD for one catalog course.
 *
 * A coming-soon course gets its own title and nothing else: the page keeps the
 * site defaults for every other tag, exactly as CourseView always did.
 */
export function courseHeadMeta(course) {
  if (!course.available) {
    return {
      title: `${course.title} — Coming Soon · ${SITE_NAME}`,
      description: null,
      canonicalUrl: null,
      jsonLd: null,
    };
  }

  const questionCount = course.publishedQuestionCount;
  const domainCount = course.mock.domains.length;
  const canonicalUrl = courseCanonicalUrl(course.id);

  return {
    title: `${course.title} — Practice Questions & Syllabus · ${SITE_NAME}`,
    description: `Free online practice questions and syllabus for ${course.title}. ${questionCount} questions across ${domainCount} domains.`,
    canonicalUrl,
    jsonLd: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Course",
          "@id": `${canonicalUrl}#course`,
          name: `${course.title} Practice Track`,
          description: `${course.title} online practice questions and study syllabus.`,
          provider: {
            "@type": "Organization",
            name: "mctl Academy",
            url: `${SITE_ORIGIN}/`,
          },
          isAccessibleForFree: true,
          inLanguage: "en",
          offers: [
            {
              "@type": "Offer",
              category: "Free",
              price: "0",
              priceCurrency: "USD",
            },
          ],
        },
        {
          "@type": "Quiz",
          "@id": `${canonicalUrl}#quiz`,
          name: `${course.title} Practice Questions`,
          description: `${questionCount} scenario-based practice questions across ${domainCount} domains.`,
          learningResourceType: "Practice Quiz",
          isAccessibleForFree: true,
          about: {
            "@type": "Thing",
            name: course.title,
          },
        },
      ],
    },
  };
}
