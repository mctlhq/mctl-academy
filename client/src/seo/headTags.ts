import { COURSE_HEAD_TAGS, headTagSelector, type CourseHeadTagSpec } from "./courseMeta.mjs";

/**
 * Writing and restoring the per-page head tags (COURSE_HEAD_TAGS) on the live
 * document, shared by CourseView and PracticeView.
 *
 * Restoring: a tag the server rewrote carries the site default in
 * `data-default`; otherwise the value found before the first write is the
 * default, kept in `saved`. Reading the live value alone would "restore" a
 * server-rendered page's own canonical or description onto whatever page
 * comes next.
 */
export type SavedHeadDefaults = Map<Element, string | null>;

type HeadMeta = Record<CourseHeadTagSpec["field"], string>;

function headTag(spec: CourseHeadTagSpec): Element | null {
  return typeof document === "undefined" ? null : document.querySelector(headTagSelector(spec));
}

export function applyHeadMeta(meta: HeadMeta, saved: SavedHeadDefaults): void {
  for (const spec of COURSE_HEAD_TAGS) {
    const el = headTag(spec);
    if (!el) continue;
    if (!el.hasAttribute("data-default") && !saved.has(el)) {
      saved.set(el, el.getAttribute(spec.attr));
    }
    el.setAttribute(spec.attr, meta[spec.field] ?? "");
  }
}

export function restoreHeadMeta(saved: SavedHeadDefaults): void {
  for (const spec of COURSE_HEAD_TAGS) {
    const el = headTag(spec);
    if (!el || (!el.hasAttribute("data-default") && !saved.has(el))) continue;
    const original = el.getAttribute("data-default") ?? saved.get(el) ?? null;
    if (original !== null) el.setAttribute(spec.attr, original);
    else el.removeAttribute(spec.attr);
  }
}
