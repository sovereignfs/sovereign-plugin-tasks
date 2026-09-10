import {
  type AutoScrollOptions,
  KeyboardSensor,
  MouseSensor as LibMouseSensor,
  TouchSensor as LibTouchSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { MouseEvent as ReactMouseEvent, TouchEvent as ReactTouchEvent } from 'react';

/** Plain pointer drag (desktop, handle-initiated) — unchanged from before the
 *  touch split, kept as a named constant since it's the tuning knob. */
const MOUSE_ACTIVATION_DISTANCE_PX = 8;

/** Long-press-to-lift on touch. `delay` is how long a still hold takes before
 *  the row lifts; `tolerance` is how far the finger may drift during that
 *  hold before it's treated as a scroll/swipe instead — a finger that moves
 *  further than this within the delay window cancels activation and the
 *  native gesture (vertical scroll, carousel swipe, edge-zone reveal) wins.
 *  Tune these two if the hold feels too eager or too laggy on a real device —
 *  that's the one thing this can't be verified for in Chromium simulation. */
const TOUCH_ACTIVATION_DELAY_MS = 300;
const TOUCH_ACTIVATION_TOLERANCE_PX = 8;

/**
 * True when a drag should be allowed to start from `target`. Refused when
 * `target` sits inside an element marked `data-no-dnd` — swipe edge zones,
 * the checkbox/star/subtask-ring, list rename inputs, and the list ⋯ button
 * all opt out so a long-press there performs its own action (or, for the
 * touch-only controls, simply does nothing) instead of lifting the row.
 * Exported standalone so it's unit-testable without spinning up dnd-kit.
 */
export function shouldHandleDndEvent(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return target.closest('[data-no-dnd]') === null;
}

// dnd-kit's documented pattern for scoping sensor activation to specific
// elements: subclass the built-in sensor and replace its static `activators`
// with a handler that inspects the originating event's target before
// deferring to the base activation logic (distance/delay/tolerance), which
// dnd-kit re-checks internally regardless of what this returns.
class MouseSensor extends LibMouseSensor {
  static override activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: ({ nativeEvent: event }: ReactMouseEvent) => shouldHandleDndEvent(event.target),
    },
  ];
}

class TouchSensor extends LibTouchSensor {
  static override activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: ({ nativeEvent: event }: ReactTouchEvent) => shouldHandleDndEvent(event.target),
    },
  ];
}

/**
 * True when `element` is a scroll container along the vertical axis — the
 * only kind of ancestor a reorder drag in this plugin should ever
 * auto-scroll. Exported standalone so it's unit-testable without dnd-kit.
 */
export function isVerticalScrollContainer(element: Element): boolean {
  if (element === element.ownerDocument.scrollingElement) return true;
  const { overflowY } = getComputedStyle(element);
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

/**
 * `autoScroll` prop for both DndContexts in this plugin (task rows, list
 * rows). dnd-kit's auto-scroller walks *every* scrollable ancestor of the
 * dragged row and nudges whichever one the pointer is near an edge of — and
 * on mobile that set includes the carousel's own horizontal scroll-snap
 * container (`.scroller` in @sovereignfs/ui's SwipableMobileCarousel,
 * `overflow-x: auto`), tried *before* the list's own vertical scroller since
 * ancestors are visited outermost-first. The default activator is the
 * pointer position, and the default threshold is the outer 20% of the
 * container on each side, so a touch reorder — which can only be started
 * from the drag handle in the row's left gutter (TaskItem.tsx) — begins
 * with the finger already inside that left zone. The moment the finger
 * wobbles a pixel leftward (dnd-kit's scroll intent is sticky for the rest
 * of the drag), the carousel gets `scrollBy`'d toward the previous list
 * mid-drag, and while it's scrolling the list's own vertical auto-scroll
 * never runs at all (the first container with any speed wins). Both lists
 * here are strictly vertical, so restrict auto-scroll to vertical scroll
 * containers; the document's scrolling element stays allowed for desktop.
 */
export const REORDER_AUTO_SCROLL: AutoScrollOptions = {
  canScroll: isVerticalScrollContainer,
};

/**
 * Shared sensor set for both reorderable lists in this plugin (task rows,
 * list rows) — MouseSensor for desktop's handle-initiated drag, TouchSensor
 * for mobile's long-press lift, KeyboardSensor unchanged. See
 * `docs/ux-improvement-plan.md` Task 1 for the full design.
 */
export function useReorderSensors() {
  return useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: MOUSE_ACTIVATION_DISTANCE_PX } }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: TOUCH_ACTIVATION_DELAY_MS,
        tolerance: TOUCH_ACTIVATION_TOLERANCE_PX,
      },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
}
