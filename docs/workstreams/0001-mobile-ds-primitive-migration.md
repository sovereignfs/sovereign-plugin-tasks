<!--
Adapted from the platform monorepo's docs/workstreams/TEMPLATE.md for use in
this plugin's own repo. This plugin has no docs/epics/ or epic task ID
system — "Epic tasks"/"Epics" fields are replaced with "Files touched" per
leg, and the plugin's own docs/ux-improvement-plan.md fills the role
docs/epics/ plays on the platform side (task-level detail lives there for
anything that grows one; otherwise the leg detail below is the task spec).
The leg contract (one leg = one branch = one PR = one review gate) and the
required-sections discipline are unchanged from the platform convention.
-->

# Workstream 0001 — Mobile: adopt Design System swipe/carousel primitives

**Status:** ⏳ In Progress (leg 1 done, PR open)\
**Date:** August 2026\
**Author:** Claude Code\
**Goal owner:** kasunben\
**RFCs:** none new — consumes platform RFC 0079's already-shipped `@sovereignfs/ui`
primitives (`SwipableMobileCarousel`, `useSnapCarousel`, `useCarouselRouteSync`,
`useSwipeReveal`); this workstream is plugin-side adoption only.\
**Plugin areas touched:** `app/_components/MobileTasksCarousel.tsx`,
`app/_components/TaskItem.tsx`, `app/ListSidebar.tsx`,
`app/_components/BulkActionBar.tsx`, `app/_components/DueDateControl.tsx`,
`app/_components/RecurrenceEditor.tsx`\
**Research:** none — this sequences a code-audit finding, not an open design
question. Leg 4 carries its own small design decision (see that leg).

---

## Goal

At the end of this workstream, sovereign-tasks' mobile shell no longer
hand-rolls the carousel scroll/settle/pathname-sync logic or the swipe-to-
reveal gesture handling that `@sovereignfs/ui` now provides as shared
primitives — both were literally extracted _from_ this plugin's own code
(per those primitives' own doc comments), and the DS's own docs flag the
plugin's still-hand-rolled carousel as measurably laggier than the version
already migrated (`sovereign-shopper`). Two smaller UI inconsistencies found
in the same audit (a leftover native `<dialog>` in `BulkActionBar`, and a
missing first-run discoverability hint for task-row swipe) are fixed
alongside. A last, smaller leg makes and — if warranted — implements a
deliberate decision for how `DueDateControl`/`RecurrenceEditor` should behave
on mobile, rather than leaving that as an unreviewed gap.

## Definition of done

- [ ] `MobileTasksCarousel` renders through `@sovereignfs/ui`'s
      `SwipableMobileCarousel` and drives its index via `useCarouselRouteSync`
      — no hand-rolled `scroll`-event debounce, `scrollTo`, or
      pathname↔index sync logic remains in the plugin.
- [ ] The carousel's per-list task cache (`listState`, neighbor prefetch,
      optimistic patch sync, `refreshSignal` handling) is preserved with
      identical behavior, re-homed into plugin-local glue that composes with
      the DS component rather than fighting it.
- [ ] `TaskItem.tsx` and `ListSidebar.tsx`'s swipe-to-reveal both use
      `@sovereignfs/ui`'s `useSwipeReveal` — no duplicated pointer-down/move/up
      axis-locking math remains in either file.
- [ ] `BulkActionBar`'s delete confirmation uses `ConfirmDialog`; the native
      `<dialog>` element and its dedicated CSS block are gone.
- [ ] Task rows get a first-run swipe-discovery hint, mirroring
      `ListSidebar`'s existing list-row peek, gated on its own localStorage
      flag.
- [ ] A decision is recorded (and, if it calls for a code change,
      implemented) for whether `DueDateControl`/`RecurrenceEditor` should
      fork Popover→Sheet on mobile like the colour picker does — reached via
      a wireframe pass (`sv-ui-design`), not decided inline during
      implementation.
- [ ] `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` pass
      for every leg; each leg's PR includes a manual mobile-viewport
      (or iOS Simulator) verification pass covering swipe-reveal, carousel
      swipe, and the task-detail sheet.
- [ ] The plugin's own `CLAUDE.md` "Mobile shell" and "Drag reorder" sections
      are updated to describe the DS-primitive-based architecture in place
      of the current hand-rolled description.
- [ ] `docs/ux-improvement-plan.md`'s index table gets a new row (or this
      workstream is cross-referenced from it) so the two planning documents
      don't silently diverge.

## Decisions locked

| Decision                                             | Choice                                                                                                                | Rejected alternative and why                                                                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carousel mechanics                                   | Adopt `SwipableMobileCarousel` + `useSnapCarousel` + `useCarouselRouteSync` from `@sovereignfs/ui`                    | Keep the hand-rolled version — rejected: `SwipableMobileCarousel`'s own doc comment states the current plugin carousel is "measurably laggier" than the already-migrated `sovereign-shopper` equivalent; keeping a local fork also accrues drift risk against the now-canonical implementation.                                                                   |
| Per-list task cache ownership                        | Stays plugin-local, as glue composing with the DS component (not promoted into the DS)                                | Fold caching into a `SwipableMobileCarouselSlideBody` — rejected: that component's own doc comment explicitly warns against aggregating cross-slide data inside a slide body (it recomputes per-slide-render); this plugin's cache is task-domain business logic, not a reusable DS concern.                                                                      |
| Task-detail overlay placement                        | Stays a sibling of the carousel (`Sheet` outside `.scroller`), unchanged                                              | Move it inside a slide's children — rejected: this is the exact anti-pattern `SwipableMobileCarousel`'s doc comment calls out; the current implementation already gets this right and migration must not regress it.                                                                                                                                              |
| Swipe-to-reveal                                      | Replace both `TaskItem` and `ListSidebar` hand-rolled implementations with `useSwipeReveal`                           | Keep either or both hand-rolled — rejected: `useSwipeReveal`'s own doc comment confirms it was extracted from exactly these two duplicated call sites; no behavioral gap between them and the hook was found during audit.                                                                                                                                        |
| `BulkActionBar` confirm dialog                       | Switch to `ConfirmDialog`                                                                                             | Leave the native `<dialog>` — rejected: contradicts the plugin's own `CLAUDE.md`, which documents `ConfirmDialog` replacing this exact native-`<dialog>` pattern "at every breakpoint," already applied everywhere else in the plugin.                                                                                                                            |
| Task-row swipe hint storage key                      | New, separate localStorage key (`tasks:seen-task-swipe-hint`), independent of `ListSidebar`'s `tasks:seen-swipe-hint` | Reuse the existing key — rejected: a user who encounters a list row first (slide 0) would silently skip the task-row hint the first time they reach a list of tasks, since one flag would already be set.                                                                                                                                                         |
| `DueDateControl`/`RecurrenceEditor` mobile treatment | Deferred to leg 4, gated on a wireframe reviewed via the `sv-ui-design` skill before any code changes                 | Decide and implement inline as part of the main migration — rejected: no mockup exists yet, and per the plugin's own established practice (`ListSidebar`'s Popover→Sheet fork was a deliberate, documented UX decision — see "decision D1" in `CLAUDE.md`), a new mobile interaction pattern gets a wireframe pass first, not an ad hoc choice made mid-refactor. |

## Prerequisites

- None blocking. `@sovereignfs/ui` is consumed as `workspace:*` and already
  exports `SwipableMobileCarousel`, `SwipableMobileCarouselSlide*`,
  `useSnapCarousel`, `useCarouselRouteSync`, and `useSwipeReveal`
  (`packages/ui/src/index.ts`) — no version bump or platform-side work is
  needed before leg 1 starts.
- Confirm `pnpm install --frozen-lockfile` is clean in the plugin's checkout
  before cutting leg 1's branch (routine hygiene per the platform CLAUDE.md,
  not specific to this workstream).

## Legs

| Leg | Name                                   | Files touched                                                                      | Gate? | Done when                                                                                                                                                                                                         |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Carousel migration                     | `MobileTasksCarousel.tsx`, `MobileTasksCarousel.module.css`                        | Yes   | Carousel renders via `SwipableMobileCarousel`/`useCarouselRouteSync`; all existing carousel behavior (prefetch, cache, detail sheet, cold-load redirect, resize realign) verified unchanged on a mobile viewport. |
| 2   | Swipe-to-reveal consolidation          | `TaskItem.tsx`, `TaskItem.module.css`, `ListSidebar.tsx`, `ListSidebar.module.css` | No    | Both components use `useSwipeReveal`; no local pointer-math remains; swipe-reveal behavior unchanged for both list rows and task rows.                                                                            |
| 3   | Consistency fixes                      | `BulkActionBar.tsx`, `BulkActionBar.module.css`, `TaskItem.tsx` (hint only)        | No    | `BulkActionBar` uses `ConfirmDialog`; task rows get a first-run swipe hint on their own storage key.                                                                                                              |
| 4   | Due date / recurrence mobile treatment | `DueDateControl.tsx`, `RecurrenceEditor.tsx` (+ CSS if the decision calls for it)  | Yes   | A wireframe is reviewed and a decision is recorded; code changes (if any) match that decision exactly.                                                                                                            |

Each leg is one branch, one draft PR, one review gate. The agent runs
uninterrupted within a leg and stops at its end, per the platform's leg
contract (`docs/workstreams/README.md` in the platform repo).

## Leg detail

### Leg 1 — Carousel migration

**Files:** `app/_components/MobileTasksCarousel.tsx`,
`app/_components/MobileTasksCarousel.module.css`

**Why this leg is first:** it's the largest single piece of duplicated logic
in the plugin (~420 lines), the one the DS explicitly flags as underperforming
its own canonical version, and the riskiest change — doing it first, in
isolation, means legs 2–4 aren't reviewed against a moving target underneath
them.

**Technical notes:**

- `SwipableMobileCarousel` requires every slide to be a
  `SwipableMobileCarouselSlide` element (dev-mode warns otherwise) — the
  current implementation renders plain `<div className={styles.slide}>`
  wrappers directly around `ListSidebar`/`TasksPane`. Migrating means
  wrapping each in `SwipableMobileCarouselSlide`; check nothing in
  `MobileTasksCarousel.module.css`'s `.slide`/`.slideLoading` rules was
  relied on elsewhere (they should become dead code, not silently
  shadowed).
- `useCarouselRouteSync` replaces `indexForPathname`/the pathname-sync
  effect/`isInternalNav` ref, but has **no** built-in equivalent of the
  "cold-load at bare `/tasks` → redirect to first list once" effect
  (`didSyncInitialUrl`) — that stays plugin-local glue sitting alongside the
  hook, not inside it.
- `useSnapCarousel`'s settle debounce defaults to 120 ms, matching the
  current hand-rolled value — confirm `SwipableMobileCarousel`'s
  `settleDebounceMs` prop isn't left at a different default before removing
  the old constant.
- The DS's own `.scroller` CSS must be checked against the documented
  WebKit `-webkit-overflow-scrolling: touch` compositing bug recorded in the
  current `MobileTasksCarousel.module.css` (a real, previously-reproduced
  iOS Safari issue where a `position: fixed` overlay painted behind the
  carousel's dots). Confirm the DS component doesn't reintroduce that
  property; if it already avoids it, no action needed, but don't skip the
  check.
- The per-list `listState` cache, `patchTask`/`patchDetailTask` optimistic
  sync, and the `refreshSignal`-driven refetch effect are business logic
  specific to this plugin's data model — `SwipableMobileCarousel`'s
  `prefetchDistance` prop covers _mount-window_ behavior (which neighbor
  slides stay mounted) but not _data fetching_, so this logic is retained,
  just adapted to sit alongside the DS component instead of a hand-rolled
  scroller.
- Preserve exact current behavior for: neighbor prefetch (no spinner on a
  single swipe), the Starred aggregate's independent refetch-on-mutation,
  the `?task=` detail sheet (including its optimistic-task-while-loading
  fallback), and resize realignment on orientation change.

**Do not proceed if:** replicating the decoupled-cache "no loading spinner on
swipe" behavior on top of `SwipableMobileCarousel` turns out to need changes
to the DS component itself (not just plugin-side glue) — that's a platform-
repo change out of this workstream's scope. Stop, document the specific gap
against `SwipableMobileCarousel`'s API, and leave the current hand-rolled
carousel in place rather than shipping a partial migration. See Kill
criteria.

### Leg 2 — Swipe-to-reveal consolidation

**Files:** `app/_components/TaskItem.tsx`, `app/_components/TaskItem.module.css`,
`app/ListSidebar.tsx`, `app/ListSidebar.module.css`

**Why this leg is second:** independent of leg 1 (different files, no shared
state), but sequenced after it so leg 1's carousel rewrite isn't reviewed
alongside unrelated gesture-handling churn in the same diff window.

**Technical notes:**

- `useSwipeReveal`'s `revealWidth` is a required prop — `TaskItem` passes
  `SWIPE_REVEAL_WIDTH` (128, two 64px buttons), `ListSidebar`'s `ListItem`
  passes `SWIPE_REVEAL_WIDTH` (72, one button). Keep both plugin-local
  constants; only the pointer-handling internals move to the hook.
  `TaskItem`'s open/close callbacks stay wired to `TasksPane`'s
  `swipeOpenTaskId` state and `ListSidebar`'s to its own `swipeOpenId` state
  — the hook is uncontrolled-gesture/controlled-open-state, matching both
  call sites' existing lifted-state pattern exactly.
  `disabled` should be wired to each row's own `!isMobile` gate.
- `useSwipeReveal` writes the live transform directly to `rowRef.current`
  during drag (not React state) — confirm this doesn't fight with either
  component's existing `data-no-dnd` exclusion mechanism for dnd-kit
  (`TaskItem`'s `.swipeEdgeZone`, `ListSidebar`'s `.swipeEdgeZone`), which
  should be unaffected since it's a separate pointer-handler concern, but
  verify live rather than assuming.
- `ListSidebar`'s first-run hint effect (peek-open the first row) sets
  `swipeOpenId` directly, bypassing the hook entirely — this should keep
  working unchanged, since `useSwipeReveal`'s `open` prop is caller-owned.
- Both components' `handleRowClickCapture`-while-open behavior (a tap while
  revealed closes it instead of firing the row's normal action) is
  orthogonal to the hook and stays as-is.

**Do not proceed if:** `useSwipeReveal`'s axis-lock threshold or release
math produces observably different feel from the current hand-rolled version
on a real touch device/simulator — if so, stop and treat that as a DS bug to
report upstream rather than reintroducing a local fork to paper over it.

### Leg 3 — Consistency fixes

**Files:** `app/_components/BulkActionBar.tsx`,
`app/_components/BulkActionBar.module.css`, `app/_components/TaskItem.tsx`
(hint addition only)

**Why this leg is third:** both fixes are small, independent of legs 1–2,
and low-risk — bundling them keeps the workstream from spending a whole leg
on either alone.

**Technical notes:**

- `BulkActionBar`'s delete flow (`confirmingDelete` state,
  `deleteDialogRef`/`showModal()`/`close()` effects, the native `<dialog>`
  markup and its `.confirmNativeDialog`/`.confirm*` CSS) should be replaced
  wholesale by `ConfirmDialog`, matching the exact usage pattern already in
  `TaskItem.tsx`/`ListSidebar.tsx` (`open`, `onClose`, `onConfirm`, `title`,
  `message`, `confirmLabel`, `destructive`). Delete the now-dead CSS block
  rather than leaving it unreferenced.
- Task-row first-run hint: mirror `ListSidebar.tsx`'s existing effect
  (lines ~107–132) — peek the swipe-reveal of the first _visible_ task row
  open then closed once, gated on `isMobile` and a `localStorage` flag
  (`tasks:seen-task-swipe-hint`, per the locked decision above). Needs its
  own "first row" concept scoped to whichever list/slide is active — reuse
  `TasksPane`'s existing `swipeOpenTaskId` lift-up state (`onSwipeOpen`) to
  trigger it the same way `ListSidebar` drives `swipeOpenId`, rather than
  adding a second, parallel state mechanism.

**Do not proceed if:** nothing — this leg has no open design question, just
two mechanical, well-precedented fixes.

### Leg 4 — Due date / recurrence mobile treatment

**Files:** `app/_components/DueDateControl.tsx`,
`app/_components/RecurrenceEditor.tsx`, associated CSS if the decision calls
for changes

**Why this leg is last:** it's the one item in the audit that's an open
design question, not a confirmed bug — it needs a decision before it needs
code, unlike legs 1–3.

**Technical notes:**

- Both components currently render an unconditional `Popover` at every
  breakpoint, unlike `ListSidebar`'s colour picker (which forks
  Popover-desktop / Sheet-mobile, a decision already made and documented as
  "D1" in this plugin's `CLAUDE.md`). Both are opened from inside
  `TaskDetailPane`, which is itself already inside a `Sheet` on mobile — a
  nested-overlay case nothing else in the plugin exercises.
- `RecurrenceEditor`'s "Custom…" panel (interval input, frequency select,
  weekday pills, three radio-gated end-condition rows) is the denser of the
  two and the more likely candidate for a Sheet if either needs one.
  `DueDateControl` already got a partial mobile pass (`width="trigger"`,
  per its own comment about a prior fixed-width bug) — the calendar grid's
  44px touch targets are already correct.
- Run this leg's first step through the `sv-ui-design` skill: wireframe the
  mobile behavior of both (or confirm current behavior is acceptable) before
  writing any code. It is a legitimate, first-class outcome of this leg
  that the wireframe review concludes Popover is fine as-is on mobile —
  in that case this leg ships as a documented decision with **no** code
  change, not a forced refactor to justify the leg's existence.
- If a Sheet fork is chosen, follow the same pattern
  `ListSidebar.tsx`/`ListItem` already establishes: `isMobile` gates which
  renders; both share the same commit handlers (`commit`/`commitAndClose`
  for due date, `commit`/`applyPreset` for recurrence) so behavior doesn't
  fork, only presentation does.

**Do not proceed if:** the wireframe review surfaces a materially different
UX question (e.g. whether the calendar/recurrence editor should become its
own full-page mobile view rather than a Sheet) — stop and let that become
its own follow-up rather than scope-creeping this leg.

## Risks

- **Resolved during leg 1, documented here for visibility**: `SwipableMobileCarousel`/`useSnapCarousel` expose no imperative "re-snap to the current index" hook, so the old orientation-resize realignment effect (a `window` `resize` listener that re-computed `scrollLeft`) has no clean equivalent without reaching into the DS component's internal DOM structure. Dropped rather than hacked around — a rotation may leave scroll position fractionally off-boundary until the next swipe, cosmetic only (active slide/URL stay correct). If this proves disruptive in practice, the fix belongs upstream in `SwipableMobileCarousel` (e.g. an internal `ResizeObserver` that re-calls its own `scrollToIndex`), not as a plugin-local workaround.
- Leg 1 touches the most heavily-commented, most-reasoned-about file in the
  plugin (`MobileTasksCarousel.tsx`) — the inline comments encode several
  previously-fixed bugs (iOS `scrollend` support, the cold-load
  index-0-vs-index-1 ambiguity, the WebKit compositing bug). A rewrite that
  doesn't re-read and preserve every one of those constraints risks
  reintroducing a bug that was already fixed once.
- `SwipableMobileCarousel` mandates `SwipableMobileCarouselSlide` children —
  this is a real DOM-structure change (new wrapper elements), not a pure
  logic swap. Anything incidentally depending on the old `.slide` DOM shape
  (CSS specificity, a query selector, `Sheet`'s stacking-context
  assumptions) needs to be re-verified, not assumed compatible.
- Real-device verification is limited to whatever's available in this
  environment (iOS Simulator, if reachable) — scroll-snap and touch-gesture
  feel are historically the class of bug that differs between Simulator/
  WebView and real Safari (per this plugin's own iOS PWA history noted in
  `CLAUDE.md`). Simulator-verified is not the same guarantee as
  device-verified; say so explicitly in each leg's PR rather than implying
  full confidence.
- Leg 4 is a genuine UX judgment call. If it gets treated as "just another
  refactor leg" and implemented without the wireframe step actually
  happening, it violates the plugin's own established design process
  (`sv-ui-design`) for exactly this class of change.

## Kill criteria

- If leg 1 hits its documented gate condition (DS component can't replicate
  current caching/no-spinner behavior without a platform-side change), leg 1
  stops and the current hand-rolled carousel stays in place — it is not
  broken, just not yet deduplicated. Legs 2 and 3 are independent and should
  proceed regardless of leg 1's outcome; leg 4 is independent of all three.
- Leg 4 may legitimately conclude "no change" after the wireframe review —
  that is a completed leg, not an abandoned one, and closes the audit
  finding either way (decision recorded either way).
- Nothing about this workstream is all-or-nothing: each leg ships
  independently-reviewable, coherent value, and any subset that lands is
  strictly better than the state audited at the start.

## Changelog

| Version | Date        | Change                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1     | August 2026 | Initial draft, from the mobile UI audit.                                                                                                                                                                                                                                                                                                                                                                                     |
| 0.2     | August 2026 | Leg 1 implemented and manually verified (`feat/mobile-ds-primitive-migration-leg-1`, plugin `v0.16.1`). Dropped the old resize-realignment effect rather than reimplementing it against the DS component's public API — no imperative re-snap hook is exposed; noted as a known, accepted, cosmetic-only gap in the plugin's `CLAUDE.md` and this doc's Risks section instead of working around it with a DOM-reaching hack. |
