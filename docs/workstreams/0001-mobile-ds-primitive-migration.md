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

**Status:** ⏳ In Progress (legs 1 and 5 done, PRs open)\
**Date:** August 2026\
**Author:** Claude Code\
**Goal owner:** kasunben\
**RFCs:** none new — consumes platform RFC 0079's already-shipped `@sovereignfs/ui`
primitives (`SwipableMobileCarousel`, `useSnapCarousel`, `useCarouselRouteSync`,
`useSwipeReveal`); this workstream is plugin-side adoption only.\
**Plugin areas touched:** `app/_components/MobileTasksCarousel.tsx`,
`app/_components/TaskItem.tsx`, `app/ListSidebar.tsx`,
`app/_components/BulkActionBar.tsx`, `app/_components/DueDateControl.tsx`,
`app/_components/RecurrenceEditor.tsx`,
`app/_components/MobileAwareShell.tsx`, `app/layout.tsx`, `manifest.json`\
**Research:** none — this sequences a code-audit finding, not an open design
question. Leg 4 carries its own small design decision (see that leg). Leg 5
was initially designed as a new platform-repo manifest field and mechanism,
then reverted in favor of a plugin-repo-only self-render approach once
`example-mobile-poc` showed the existing `mobileHeader`/`mobileFooter` toggle
was already sufficient — see that leg's own note and this doc's Changelog.

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
- [x] Tasks' mobile footer is self-rendered (`shellConfig.mobileFooter: false` + `@sovereignfs/ui`'s `MobileFooter`/`MobileAppsDrawer`) — the left icon
      opens the Lists slide (carousel index 0) via `onSettle(0)`, the center
      Apps button opens a drawer of every other installed, launchable plugin
      (fetched server-side via `sdk.plugins.list()`), and the right icon opens
      this plugin's own `/tasks/search`. The Launcher gets the platform's own
      icon treatment on the center button but — unlike the platform's own
      drawer — is **not** excluded from the drawer grid, since this footer's
      left icon no longer doubles as "Home" the way the platform's does.

## Decisions locked

| Decision                                             | Choice                                                                                                                                                                                                                                                                                                                                                                                         | Rejected alternative and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carousel mechanics                                   | Adopt `SwipableMobileCarousel` + `useSnapCarousel` + `useCarouselRouteSync` from `@sovereignfs/ui`                                                                                                                                                                                                                                                                                             | Keep the hand-rolled version — rejected: `SwipableMobileCarousel`'s own doc comment states the current plugin carousel is "measurably laggier" than the already-migrated `sovereign-shopper` equivalent; keeping a local fork also accrues drift risk against the now-canonical implementation.                                                                                                                                                                                                                                                                                                    |
| Per-list task cache ownership                        | Stays plugin-local, as glue composing with the DS component (not promoted into the DS)                                                                                                                                                                                                                                                                                                         | Fold caching into a `SwipableMobileCarouselSlideBody` — rejected: that component's own doc comment explicitly warns against aggregating cross-slide data inside a slide body (it recomputes per-slide-render); this plugin's cache is task-domain business logic, not a reusable DS concern.                                                                                                                                                                                                                                                                                                       |
| Task-detail overlay placement                        | Stays a sibling of the carousel (`Sheet` outside `.scroller`), unchanged                                                                                                                                                                                                                                                                                                                       | Move it inside a slide's children — rejected: this is the exact anti-pattern `SwipableMobileCarousel`'s doc comment calls out; the current implementation already gets this right and migration must not regress it.                                                                                                                                                                                                                                                                                                                                                                               |
| Swipe-to-reveal                                      | Replace both `TaskItem` and `ListSidebar` hand-rolled implementations with `useSwipeReveal`                                                                                                                                                                                                                                                                                                    | Keep either or both hand-rolled — rejected: `useSwipeReveal`'s own doc comment confirms it was extracted from exactly these two duplicated call sites; no behavioral gap between them and the hook was found during audit.                                                                                                                                                                                                                                                                                                                                                                         |
| `BulkActionBar` confirm dialog                       | Switch to `ConfirmDialog`                                                                                                                                                                                                                                                                                                                                                                      | Leave the native `<dialog>` — rejected: contradicts the plugin's own `CLAUDE.md`, which documents `ConfirmDialog` replacing this exact native-`<dialog>` pattern "at every breakpoint," already applied everywhere else in the plugin.                                                                                                                                                                                                                                                                                                                                                             |
| Task-row swipe hint storage key                      | New, separate localStorage key (`tasks:seen-task-swipe-hint`), independent of `ListSidebar`'s `tasks:seen-swipe-hint`                                                                                                                                                                                                                                                                          | Reuse the existing key — rejected: a user who encounters a list row first (slide 0) would silently skip the task-row hint the first time they reach a list of tasks, since one flag would already be set.                                                                                                                                                                                                                                                                                                                                                                                          |
| `DueDateControl`/`RecurrenceEditor` mobile treatment | Deferred to leg 4, gated on a wireframe reviewed via the `sv-ui-design` skill before any code changes                                                                                                                                                                                                                                                                                          | Decide and implement inline as part of the main migration — rejected: no mockup exists yet, and per the plugin's own established practice (`ListSidebar`'s Popover→Sheet fork was a deliberate, documented UX decision — see "decision D1" in `CLAUDE.md`), a new mobile interaction pattern gets a wireframe pass first, not an ad hoc choice made mid-refactor.                                                                                                                                                                                                                                  |
| Footer left-icon customization mechanism (leg 5)     | **Superseded — see the row below.** Originally: a new, generic platform manifest field (`shellConfig.mobileFooterLeftAction`) any `shell: default` plugin could opt into. Designed, fully implemented, and opened as a platform-repo draft PR, then reverted (closed, unmerged) once `example-mobile-poc` was actually read in full and turned out to already demonstrate the correct pattern. | Self-render (see below) was rejected at design time on the belief that the center Apps launcher and right Search icon depend on shell-only data not exposed to plugins — this belief turned out to be wrong for the Apps drawer (`sdk.plugins.list()` is a real, documented, if server-only, SDK method) and only partially right for Search (no instance-wide search SDK exists, but a plugin's own search page is a perfectly good substitute). The platform field added real surface area (a manifest field, middleware header, shell wiring) to solve a problem that didn't require any of it. |
| Footer left-icon customization mechanism (corrected) | Tasks self-renders `@sovereignfs/ui`'s `MobileFooter`/`MobileAppsDrawer` (`shellConfig.mobileFooter: false`), matching `example-mobile-poc`'s existing, already-shipped pattern exactly                                                                                                                                                                                                        | Keep the reverted platform manifest field — rejected per the row above. Special-case the shared `MobileNav` component to recognize `/tasks` — rejected: puts one plugin's identity into shared platform code, the exact anti-pattern the platform's plugin-system architecture forbids.                                                                                                                                                                                                                                                                                                            |
| Apps drawer content                                  | Populated from `sdk.plugins.list()`, called server-side in `layout.tsx` (the method needs `next/headers`) and passed down as a prop                                                                                                                                                                                                                                                            | Fetch client-side via the undocumented `/api/plugins/sidebar` route the platform's own `MobileNav` hydration uses — rejected: not part of the SDK contract, not documented for plugin use, and omits the offline-tier field `sdk.plugins.list()` also lacks anyway, so it buys nothing but an unsanctioned dependency.                                                                                                                                                                                                                                                                             |
| Launcher's treatment in the self-rendered footer     | Gets the platform's own icon (`/plugin-icons/<id>.svg`) on the center Apps button, matching `MobileNav` exactly, and stays included as a normal tile in the drawer grid                                                                                                                                                                                                                        | Also exclude Launcher from the drawer grid, matching the platform's own drawer exclusion — rejected (caught and reverted after initially shipping it): that exclusion only works on the platform's own footer because its separate left icon is a dedicated, always-present "Home" button. This footer's left icon is repurposed for "Lists" (see above), so the drawer is the only remaining way back to the Launcher; excluding it would silently strand users with no path home.                                                                                                                |
| Right icon destination                               | Routes to this plugin's own `/tasks/search`                                                                                                                                                                                                                                                                                                                                                    | Route to the platform's instance-wide search overlay — rejected: that overlay (`MobileSearch`) is runtime-local, not exposed to plugins at all; the plugin's own search page is a reasonable, arguably more relevant substitute (searching from within Tasks most likely means searching tasks).                                                                                                                                                                                                                                                                                                   |

## Prerequisites

- None blocking legs 1–4. `@sovereignfs/ui` is consumed as `workspace:*` and
  already exports `SwipableMobileCarousel`, `SwipableMobileCarouselSlide*`,
  `useSnapCarousel`, `useCarouselRouteSync`, and `useSwipeReveal`
  (`packages/ui/src/index.ts`) — no version bump or platform-side work is
  needed before leg 1 starts.
- Confirm `pnpm install --frozen-lockfile` is clean in the plugin's checkout
  before cutting a leg's branch (routine hygiene per the platform CLAUDE.md,
  not specific to this workstream).
- None blocking leg 5 either, now that it's plugin-repo-only: `sdk.plugins.list()`
  and `@sovereignfs/ui`'s `MobileFooter`/`MobileAppsDrawer` are already
  available in this checkout's existing dependency versions — no platform
  release to wait on (the earlier platform-repo dependency was retracted; see
  Decisions locked).

## Legs

| Leg | Name                                   | Files touched                                                                                                                                                          | Gate? | Done when                                                                                                                                                                                                                                                                                                   |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Carousel migration                     | `MobileTasksCarousel.tsx`, `MobileTasksCarousel.module.css`                                                                                                            | Yes   | Carousel renders via `SwipableMobileCarousel`/`useCarouselRouteSync`; all existing carousel behavior (prefetch, cache, detail sheet, cold-load redirect, resize realign) verified unchanged on a mobile viewport.                                                                                           |
| 2   | Swipe-to-reveal consolidation          | `TaskItem.tsx`, `TaskItem.module.css`, `ListSidebar.tsx`, `ListSidebar.module.css`                                                                                     | No    | Both components use `useSwipeReveal`; no local pointer-math remains; swipe-reveal behavior unchanged for both list rows and task rows.                                                                                                                                                                      |
| 3   | Consistency fixes                      | `BulkActionBar.tsx`, `BulkActionBar.module.css`, `TaskItem.tsx` (hint only)                                                                                            | No    | `BulkActionBar` uses `ConfirmDialog`; task rows get a first-run swipe hint on their own storage key.                                                                                                                                                                                                        |
| 4   | Due date / recurrence mobile treatment | `DueDateControl.tsx`, `RecurrenceEditor.tsx` (+ CSS if the decision calls for it)                                                                                      | Yes   | A wireframe is reviewed and a decision is recorded; code changes (if any) match that decision exactly.                                                                                                                                                                                                      |
| 5   | Self-rendered mobile footer            | `manifest.json`, `app/layout.tsx`, `app/_components/MobileAwareShell.tsx`, `app/_components/MobileTasksCarousel.tsx`, `app/_components/MobileTasksCarousel.module.css` | No    | `shellConfig.mobileFooter: false`; left icon opens the Lists slide, center Apps drawer lists every other launchable plugin (Launcher included, with the real Launcher icon on the center button), right icon opens `/tasks/search`. Verified on a mobile viewport, no console errors, "way home" reachable. |

Each leg is one branch, one draft PR, one review gate. The agent runs
uninterrupted within a leg and stops at its end, per the platform's leg
contract (`docs/workstreams/README.md` in the platform repo). Leg 5's branch
is stacked on leg 1's (not cut from `main`) since it depends on leg 1's
`useCarouselRouteSync`/`onSettle` refactor, which hasn't merged yet — its PR
targets leg 1's branch rather than `main` for the same reason.

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

### Leg 5 — Self-rendered mobile footer

**Files:** `manifest.json`, `app/layout.tsx`,
`app/_components/MobileAwareShell.tsx`,
`app/_components/MobileTasksCarousel.tsx`,
`app/_components/MobileTasksCarousel.module.css`

**Why this leg exists:** the mobile footer's left icon (platform default:
"Home") is shared shell chrome, not owned by any plugin. Discovered
mid-workstream while trying to make Tasks' left icon open its own Lists
slide instead of navigating away to the platform Launcher.

**This leg's design changed mid-flight — worth reading before touching this
code.** The first attempt added a new platform-repo manifest field
(`shellConfig.mobileFooterLeftAction`) and matching middleware/shell wiring,
fully implemented and opened as a draft PR in the platform monorepo. It was
reverted (PR closed, unmerged) once `example-mobile-poc` — an existing
in-repo reference plugin — was read in full and turned out to already
demonstrate the correct, much smaller pattern: `shellConfig.mobileFooter:
false` (an _existing_ capability) plus the plugin self-rendering
`@sovereignfs/ui`'s own `MobileFooter`. The belief that blocked this path at
design time — that the center Apps button and right Search icon need
shell-only data unavailable to plugins — was wrong for the Apps drawer
(`sdk.plugins.list()` is a real, server-side-callable SDK method) and only
partially right for Search (solved by pointing at the plugin's own search
page instead of the platform's instance-wide one). See Decisions locked for
the full account of what was tried and rejected.

**Technical notes:**

- `manifest.json`: `"shellConfig": { "mobileFooter": false }`. `mobileHeader`
  is left at its default (`true`) — the platform's own header (brand, bell,
  avatar) is untouched; only the footer is self-rendered.
- `layout.tsx` (a Server Component) calls `sdk.plugins.list()` — this needs
  `next/headers`, so it can't be called from `MobileTasksCarousel` itself —
  and maps the result to a lean `FooterAppEntry[]` (id, name, routePrefix,
  iconUrl), excluding this plugin itself and anything not `availableToUser`
  (disabled/adminOnly-gated/paywalled). Also resolves the Launcher's own
  `iconUrl` separately, for the footer's center button. Both are threaded
  down through `MobileAwareShell` (desktop ignores them) to
  `MobileTasksCarousel`.
- `MobileTasksCarousel.tsx` renders `MobileFooter` + `MobileAppsDrawer` from
  `@sovereignfs/ui` as siblings of the carousel (not inside a slide — same
  "don't mount overlay chrome inside a slide" rule leg 1 already follows for
  the detail `Sheet`):
  - Left icon: `onClick: () => onSettle(0)` — the same `onSettle` this
    component already gets from `useCarouselRouteSync` (leg 1), reused
    directly rather than a new navigation path. **Not** a navigation to bare
    `/tasks`, which already has its own established meaning (cold-load →
    redirect to the first list); jumping via `onSettle` sidesteps that
    entirely.
  - Center: `launcherIcon` set to the Launcher's real icon (`<img
src={launcherIconUrl} />`), matching the platform shell's own `MobileNav`
    treatment pixel-for-pixel (same size, same dark-mode invert filter) —
    **not** the DS component's generic default grid icon, which is what the
    first pass shipped before catching and fixing the mismatch.
  - Right icon: `router.push('/tasks/search')` — this plugin's own existing
    search page, not the platform's instance-wide search overlay (which
    isn't exposed to plugins at all).
- **`.wrap`'s CSS had to become a flex column** (`.carouselArea` at `flex: 1;
min-height: 0`), not a plain stacked block. `SwipableMobileCarousel` already
  fills 100% of whatever height it's given; a `MobileFooter` sibling placed
  after it in a non-flex `.wrap` gets pushed below the fold and clipped by
  the shell's own `overflow: hidden` (`layout.module.css`'s `.shell`) —
  present in the DOM, fully functional, but completely invisible. A real bug
  hit and fixed while building this leg, not a hypothetical.
- **The Launcher is deliberately kept in the Apps drawer grid**, unlike the
  platform's own drawer (which excludes it — "hidden from its own tiles" —
  in favor of the footer's separate, dedicated Home left icon). That
  exclusion only holds together on the platform's own footer _because_ of
  that separate Home icon; this footer's left icon is repurposed for Lists,
  so the drawer is the only remaining way back to the Launcher. This was
  also caught and fixed mid-leg after an initial pass excluded it by
  copying the platform's pattern without checking whether the precondition
  it depends on still held here.

**Do not proceed if:** nothing further — this leg is done and verified (see
Definition of done). Recorded here as a cautionary example: two of this
leg's three real mistakes (the unnecessary platform PR, the missing
launcher icon, the Launcher drawer exclusion) came from copying an existing
pattern without verifying its actual mechanism or its preconditions still
applied in the new context. Read the thing you're copying, not just its
shape.

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
- Leg 5's first design (a new platform manifest field) got as far as a full
  implementation and a draft PR in the platform monorepo before being
  reverted — a real, if caught-in-time, cost of not reading
  `example-mobile-poc` closely enough before deciding a platform change was
  necessary. The corrected design has no such external dependency.
- Leg 5's self-rendered footer duplicates _some_ of the platform shell's own
  chrome (the Apps drawer, footer icons) by design — this is the accepted
  cost of `shellConfig.mobileFooter: false`, not new to this leg. Future
  changes to the platform's own `MobileNav`/`MobileFooter` conventions
  (icon choices, drawer behavior) won't automatically propagate here and
  need to be manually kept in sync, same as `example-mobile-poc` already
  has to.

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

| Version | Date        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0.1     | August 2026 | Initial draft, from the mobile UI audit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| 0.2     | August 2026 | Leg 1 implemented and manually verified (`feat/mobile-ds-primitive-migration-leg-1`, plugin `v0.16.1`). Dropped the old resize-realignment effect rather than reimplementing it against the DS component's public API — no imperative re-snap hook is exposed; noted as a known, accepted, cosmetic-only gap in the plugin's `CLAUDE.md` and this doc's Risks section instead of working around it with a DOM-reaching hack.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 0.3     | August 2026 | Added legs 5–6: a cross-repo mobile-footer left-icon customization mechanism, prompted by wanting Tasks' footer left icon to open the Lists slide instead of the platform Launcher — a new platform manifest field (leg 5) plus this plugin's consumption of it (leg 6). **Superseded by 0.4 — see that entry.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 0.4     | August 2026 | Reverted the platform manifest field entirely (PR closed, unmerged, branch deleted) after actually reading `example-mobile-poc` in full: `shellConfig.mobileFooter: false` (already existing) plus a self-rendered `@sovereignfs/ui` `MobileFooter`/`MobileAppsDrawer` was already sufficient, no platform change needed. Collapsed legs 5–6 into a single plugin-repo-only leg 5 and implemented it (`feat/mobile-footer-left-action`, stacked on leg 1's branch, plugin `v0.17.0`). Two follow-up mistakes caught and fixed during manual verification: the footer was initially invisible (clipped by the shell's `overflow: hidden` — `.wrap` needed a real flex layout, not a stacked block) and the center Apps button initially used the DS default grid icon instead of the Launcher's own (and briefly, incorrectly, excluded the Launcher from the drawer grid entirely, which would have left no way back to the platform Launcher at all). |
