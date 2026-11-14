import { onBeforeUnmount, onMounted, ref, type Ref } from "vue";

/**
 * Show/hide rule for the phone header's second row (the course switcher).
 *
 * On a phone the sticky header wraps onto two rows, which costs a large share
 * of the viewport while reading. The second row tucks away while the learner
 * scrolls down and comes back on any deliberate scroll up, near the top of the
 * page, or whenever something needs it (focus inside it, an open menu).
 *
 * Kept pure so the rule is tested without a browser: the caller feeds the
 * current scroll position and gets the next state back.
 */
export interface CollapseState {
  collapsed: boolean;
  /** Scroll position the next direction change is measured from. */
  anchorY: number;
}

export interface CollapseInput extends CollapseState {
  y: number;
  /** True when the row must stay visible regardless of scrolling. */
  blocked: boolean;
  /** At or above this scroll position the row is always shown. */
  topZone: number;
  /** Scroll distance in one direction needed to flip the state. */
  threshold: number;
}

export function nextCollapseState(input: CollapseInput): CollapseState {
  const { y, anchorY, collapsed, blocked, topZone, threshold } = input;
  if (blocked || y <= topZone) return { collapsed: false, anchorY: y };
  const delta = y - anchorY;
  if (delta >= threshold) return { collapsed: true, anchorY: y };
  if (delta <= -threshold) return { collapsed: false, anchorY: y };
  // Small movements (momentum jitter, a nudge) keep the state and keep
  // accumulating from the same anchor.
  return { collapsed, anchorY };
}

export const PHONE_HEADER_QUERY = "(max-width: 480px)";
const THRESHOLD_PX = 8;

/**
 * Wires nextCollapseState to the window: a passive scroll listener throttled
 * to one update per animation frame. Only active while PHONE_HEADER_QUERY
 * matches; above it the row is never collapsed. `row` is the element whose
 * focus keeps it visible; `isBlocked` adds the caller's own reasons.
 */
export function useCollapsingRow(
  header: Ref<HTMLElement | null>,
  row: Ref<HTMLElement | null>,
  isBlocked: () => boolean,
): Ref<boolean> {
  const collapsed = ref(false);
  let anchorY = 0;
  let frame = 0;
  const phone =
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(PHONE_HEADER_QUERY) : null;

  function update() {
    frame = 0;
    const y = window.scrollY;
    const focusInRow = !!row.value && row.value.contains(document.activeElement);
    const next = nextCollapseState({
      y,
      anchorY,
      collapsed: collapsed.value,
      blocked: !phone?.matches || focusInRow || isBlocked(),
      topZone: header.value?.offsetHeight ?? 0,
      threshold: THRESHOLD_PX,
    });
    anchorY = next.anchorY;
    collapsed.value = next.collapsed;
  }

  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(update);
  }

  // Focus reaching the row (Tab, a screen reader's virtual cursor moving
  // focus) shows it at once rather than on the next scroll.
  function onFocusIn(e: FocusEvent) {
    if (row.value && e.target instanceof Node && row.value.contains(e.target)) {
      collapsed.value = false;
      anchorY = window.scrollY;
    }
  }

  onMounted(() => {
    anchorY = window.scrollY;
    window.addEventListener("scroll", schedule, { passive: true });
    phone?.addEventListener("change", schedule);
    header.value?.addEventListener("focusin", onFocusIn);
  });
  onBeforeUnmount(() => {
    window.removeEventListener("scroll", schedule);
    phone?.removeEventListener("change", schedule);
    header.value?.removeEventListener("focusin", onFocusIn);
    if (frame) window.cancelAnimationFrame(frame);
    frame = 0;
  });

  return collapsed;
}
