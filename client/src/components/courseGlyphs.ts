/**
 * Original line glyphs for the course cards, one per course id.
 *
 * LEGAL.md: no vendor logos, wordmarks, colours or design elements anywhere.
 * These are plain geometric marks drawn for this project, stroked in
 * `currentColor` so the card picks the hue from the design tokens; nothing
 * here is traced from or styled after any vendor's artwork.
 *
 * Drawn on a 96x64 grid. A course with no glyph of its own (a new course file)
 * gets the fallback, so adding a course never needs a change here.
 */
export interface GlyphShape {
  tag: "path" | "circle" | "rect" | "line";
  attrs: Record<string, string | number>;
}

export interface CourseGlyph {
  /** A design-token hue, e.g. `--accent-cyan`. */
  hue: string;
  shapes: GlyphShape[];
}

const circle = (
  cx: number,
  cy: number,
  r: number,
  extra: Record<string, string | number> = {},
): GlyphShape => ({
  tag: "circle",
  attrs: { cx, cy, r, ...extra },
});
const path = (d: string, extra: Record<string, string | number> = {}): GlyphShape => ({
  tag: "path",
  attrs: { d, ...extra },
});
const rect = (x: number, y: number, width: number, height: number, rx = 3): GlyphShape => ({
  tag: "rect",
  attrs: { x, y, width, height, rx },
});

const FILLED = { fill: "currentColor", stroke: "none" };

const glyphs: Record<string, CourseGlyph> = {
  // An agent node reaching out to three tools.
  "agentic-ai-builder": {
    hue: "--accent-lilac",
    shapes: [
      path("M48 32 L22 16 M48 32 L74 16 M48 32 L48 54"),
      circle(48, 32, 9),
      circle(48, 32, 3, FILLED),
      rect(14, 9, 14, 14),
      rect(67, 9, 14, 14),
      rect(41, 50, 14, 10),
    ],
  },
  // A lens over a meridian grid: looking things up on the open web.
  "agentic-web-search": {
    hue: "--accent-cyan",
    shapes: [
      circle(40, 30, 18),
      path("M22 30 H58 M40 12 C30 20 30 40 40 48 M40 12 C50 20 50 40 40 48"),
      circle(66, 42, 9),
      path("M72.5 48.5 L82 58"),
    ],
  },
  // Three stacked machines with status lights.
  "ai-cloudops-engineer": {
    hue: "--accent-lime",
    shapes: [
      rect(24, 8, 48, 14),
      rect(24, 25, 48, 14),
      rect(24, 42, 48, 14),
      circle(32, 15, 2, FILLED),
      circle(32, 32, 2, FILLED),
      circle(32, 49, 2, FILLED),
      path("M50 15 H64 M50 32 H64 M50 49 H58"),
    ],
  },
  // Rising bars under a trend line: decisions and direction.
  "ai-leader": {
    hue: "--accent-terracotta",
    shapes: [
      path("M18 56 H78"),
      rect(24, 40, 10, 16, 2),
      rect(40, 30, 10, 26, 2),
      rect(56, 20, 10, 36, 2),
      path("M20 34 L44 20 L58 26 L78 10 M70 10 H78 V18"),
    ],
  },
  // A jointed arm with a gripper.
  "physical-ai": {
    hue: "--accent-lilac",
    shapes: [
      path("M22 58 H50"),
      path("M36 58 V48 L30 30 L58 18 L70 30"),
      circle(36, 48, 4),
      circle(30, 30, 4),
      circle(58, 18, 4),
      path("M70 30 L64 38 M70 30 L78 36"),
    ],
  },
  // A chip with pins feeding a rack: running GPU platforms.
  "ai-infrastructure-engineer": {
    hue: "--accent-lime",
    shapes: [
      rect(30, 18, 28, 28, 4),
      rect(38, 26, 12, 12, 2),
      path("M36 12 V18 M44 12 V18 M52 12 V18 M36 46 V52 M44 46 V52 M52 46 V52"),
      path("M24 24 H30 M24 32 H30 M24 40 H30 M58 32 H72"),
      rect(72, 22, 10, 20, 2),
    ],
  },
  // Connected blocks on a grid: designing a solution.
  "ai-solutions-architect": {
    hue: "--accent-cyan",
    shapes: [
      rect(14, 10, 22, 16),
      rect(60, 10, 22, 16),
      rect(37, 40, 22, 16),
      path("M25 26 V33 H48 V40 M71 26 V33 H48"),
    ],
  },
};

const fallback: CourseGlyph = {
  hue: "--accent",
  shapes: [circle(48, 32, 20), circle(48, 32, 11), circle(48, 32, 3, FILLED)],
};

export function glyphFor(courseId: string): CourseGlyph {
  return glyphs[courseId] ?? fallback;
}
