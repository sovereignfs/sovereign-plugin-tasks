'use client';

import { useIsMobile as useDsIsMobile } from '@sovereignfs/ui';

// This plugin forks its *component tree* (three-column web vs. mobile
// carousel) at 768px — matching the platform's own canonical breakpoint
// (@sovereignfs/ui's `useIsMobile` / `MOBILE_BREAKPOINT_PX`) rather than a
// narrower plugin-local threshold. Previously pinned to 640px specifically
// to keep iPad-class viewports (768px+ portrait) on the desktop
// three-column layout — reversed by deliberate decision (see
// docs/data-fetching-and-mobile-interaction-findings.md Issue 5): iPad now
// gets the mobile carousel instead. This threshold must stay in lockstep
// with the matching `@media (max-width: 768px)` blocks in
// `TaskItem.module.css` and `ListSidebar.module.css` (the plugin's other
// two files with mobile-only CSS gated to this same breakpoint).
//
// DS-first: the matchMedia/SSR logic lives in the design system — this file
// is only the plugin's own breakpoint bound to that hook, not a
// reimplementation.
const TASKS_MOBILE_BREAKPOINT_PX = 768;

/** SSR-safe; delegates to `@sovereignfs/ui` with this plugin's breakpoint
 *  (see the constant above for why it's not just the DS default import). */
export function useIsMobile(): boolean {
  return useDsIsMobile(TASKS_MOBILE_BREAKPOINT_PX);
}
