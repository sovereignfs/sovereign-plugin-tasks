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
`app/_components/RecurrenceEditor.tsx`, `manifest.json` (leg 6)\
**Platform areas touched (leg 5, cross-repo — see that leg):**
`packages/manifest/src/schema.ts`, `packages/ui/src/components/Icon/Icon.tsx`,
`runtime/src/registry.ts`, `runtime/src/mobile-chrome.ts`,
`runtime/middleware.ts`,
`runtime/app/(platform)/layout.tsx`,
`runtime/app/(platform)/_components/MobileNav.tsx`,
`runtime/app/(platform)/_components/ClientShell.tsx`\
**Research:** none — this sequences a code-audit finding, not an open design
question. Leg 4 carries its own small design decision (see that leg). Leg 5
adds a new platform mechanism decided live in conversation (see that leg's
Decisions locked entries) rather than through a separate research doc — scope
is small and the alternatives were already surveyed against the existing
`shellConfig.mobileHeader`/`mobileFooter` precedent.

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
- [ ] A `shell: default` plugin can declare `shellConfig.mobileFooterLeftAction`
      (`{icon, label, href}`) to override the platform mobile footer's left
      icon while that plugin is active; the platform's own `CLAUDE.md`
      version narration, `docs/plugin-development.md`'s manifest reference,
      and the `MobileChromeOverride`/`ClientShell` refresh-on-crossing
      mechanism are all updated to match the existing
      `mobileHeader`/`mobileFooter` precedent.
- [ ] Tasks' mobile footer left icon opens the Lists slide (carousel index 0)
      via a dedicated, refresh-safe marker URL — not bare `/tasks`, which
      keeps its existing first-list cold-load meaning unchanged.

## Decisions locked

| Decision                                                     | Choice                                                                                                                                                                                                                                                  | Rejected alternative and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Carousel mechanics                                           | Adopt `SwipableMobileCarousel` + `useSnapCarousel` + `useCarouselRouteSync` from `@sovereignfs/ui`                                                                                                                                                      | Keep the hand-rolled version — rejected: `SwipableMobileCarousel`'s own doc comment states the current plugin carousel is "measurably laggier" than the already-migrated `sovereign-shopper` equivalent; keeping a local fork also accrues drift risk against the now-canonical implementation.                                                                                                                                                                                                                                                                                                                                    |
| Per-list task cache ownership                                | Stays plugin-local, as glue composing with the DS component (not promoted into the DS)                                                                                                                                                                  | Fold caching into a `SwipableMobileCarouselSlideBody` — rejected: that component's own doc comment explicitly warns against aggregating cross-slide data inside a slide body (it recomputes per-slide-render); this plugin's cache is task-domain business logic, not a reusable DS concern.                                                                                                                                                                                                                                                                                                                                       |
| Task-detail overlay placement                                | Stays a sibling of the carousel (`Sheet` outside `.scroller`), unchanged                                                                                                                                                                                | Move it inside a slide's children — rejected: this is the exact anti-pattern `SwipableMobileCarousel`'s doc comment calls out; the current implementation already gets this right and migration must not regress it.                                                                                                                                                                                                                                                                                                                                                                                                               |
| Swipe-to-reveal                                              | Replace both `TaskItem` and `ListSidebar` hand-rolled implementations with `useSwipeReveal`                                                                                                                                                             | Keep either or both hand-rolled — rejected: `useSwipeReveal`'s own doc comment confirms it was extracted from exactly these two duplicated call sites; no behavioral gap between them and the hook was found during audit.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `BulkActionBar` confirm dialog                               | Switch to `ConfirmDialog`                                                                                                                                                                                                                               | Leave the native `<dialog>` — rejected: contradicts the plugin's own `CLAUDE.md`, which documents `ConfirmDialog` replacing this exact native-`<dialog>` pattern "at every breakpoint," already applied everywhere else in the plugin.                                                                                                                                                                                                                                                                                                                                                                                             |
| Task-row swipe hint storage key                              | New, separate localStorage key (`tasks:seen-task-swipe-hint`), independent of `ListSidebar`'s `tasks:seen-swipe-hint`                                                                                                                                   | Reuse the existing key — rejected: a user who encounters a list row first (slide 0) would silently skip the task-row hint the first time they reach a list of tasks, since one flag would already be set.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `DueDateControl`/`RecurrenceEditor` mobile treatment         | Deferred to leg 4, gated on a wireframe reviewed via the `sv-ui-design` skill before any code changes                                                                                                                                                   | Decide and implement inline as part of the main migration — rejected: no mockup exists yet, and per the plugin's own established practice (`ListSidebar`'s Popover→Sheet fork was a deliberate, documented UX decision — see "decision D1" in `CLAUDE.md`), a new mobile interaction pattern gets a wireframe pass first, not an ad hoc choice made mid-refactor.                                                                                                                                                                                                                                                                  |
| Footer left-icon customization mechanism (leg 5)             | A new, generic manifest field (`shellConfig.mobileFooterLeftAction`) any `shell: default` plugin can opt into, resolved server-side the same way `mobileHeader`/`mobileFooter` already are                                                              | (a) Tasks self-renders its own `MobileFooter` (the only existing precedent, `example-mobile-poc`) — rejected: the center Apps launcher and right Search icon depend on shell-only data (live plugin list, admin status, the search index) not exposed to plugins via the SDK; duplicating them would mean reimplementing real shell chrome, against "shell stays generic, plugins are consumers." (b) Special-case the shared `MobileNav` component to recognize `/tasks` specifically — rejected: puts one plugin's identity into shared platform code, the exact anti-pattern the platform's plugin-system architecture forbids. |
| Reaching platform Home once a plugin overrides the left icon | "Home" becomes the first item in that plugin's Apps Drawer, **only when** `mobileFooterLeftAction` is active for the current route — not added unconditionally to every plugin's drawer                                                                 | Add "Home" to every plugin's drawer unconditionally — rejected: a redundant, unrequested UX change for every plugin that never touches this feature; scoping it to only the plugins that actually lose the footer Home icon keeps the change minimal and its cause legible.                                                                                                                                                                                                                                                                                                                                                        |
| Left-icon `icon` field validation                            | Manifest schema accepts any non-empty string (no closed enum) — validity checked at render time in `MobileNav` against a new `ICON_NAMES` export from `@sovereignfs/ui`, falling back to a safe default icon with a dev-mode warning on an unknown name | Validate against a closed enum in `packages/manifest`'s zod schema — rejected: would require `packages/manifest` to depend on `packages/ui`'s `IconName` type, pulling a React-dependent design-system package into a schema-validation package meant to stay light and usable outside React contexts (CLI, generate scripts).                                                                                                                                                                                                                                                                                                     |
| Marker URL for "jump to Lists slide" (leg 6)                 | A dedicated URL Tasks' own `indexForPathname` recognizes via a search param (e.g. `/tasks?view=lists`), read alongside `pathname`                                                                                                                       | Reuse bare `/tasks` — rejected: bare `/tasks` already has an established, deliberate meaning (cold-load → redirect to the user's first list); overloading it to also mean "the Lists index" would silently break that existing behavior for every other bare-`/tasks` entry point (the Launcher tile, a bookmark, a shared link).                                                                                                                                                                                                                                                                                                  |

## Prerequisites

- None blocking legs 1–4. `@sovereignfs/ui` is consumed as `workspace:*` and
  already exports `SwipableMobileCarousel`, `SwipableMobileCarouselSlide*`,
  `useSnapCarousel`, `useCarouselRouteSync`, and `useSwipeReveal`
  (`packages/ui/src/index.ts`) — no version bump or platform-side work is
  needed before leg 1 starts.
- Confirm `pnpm install --frozen-lockfile` is clean in the plugin's checkout
  before cutting a leg's branch (routine hygiene per the platform CLAUDE.md,
  not specific to this workstream).
- **Leg 6 is blocked on leg 5's PR merging in the platform monorepo** — leg 6
  consumes a manifest field that doesn't exist until leg 5 ships. This is a
  genuine cross-repo dependency, not just a sequencing preference: this
  plugin's own `pnpm install` won't resolve a `@sovereignfs/manifest`/
  `@sovereignfs/ui` version carrying the new field until the platform release
  it lands in is available to this checkout.

## Legs

| Leg | Name                                             | Files touched                                                                                                                                                                                                                                                                                           | Gate? | Done when                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Carousel migration                               | `MobileTasksCarousel.tsx`, `MobileTasksCarousel.module.css`                                                                                                                                                                                                                                             | Yes   | Carousel renders via `SwipableMobileCarousel`/`useCarouselRouteSync`; all existing carousel behavior (prefetch, cache, detail sheet, cold-load redirect, resize realign) verified unchanged on a mobile viewport.                                                                                                                                                                |
| 2   | Swipe-to-reveal consolidation                    | `TaskItem.tsx`, `TaskItem.module.css`, `ListSidebar.tsx`, `ListSidebar.module.css`                                                                                                                                                                                                                      | No    | Both components use `useSwipeReveal`; no local pointer-math remains; swipe-reveal behavior unchanged for both list rows and task rows.                                                                                                                                                                                                                                           |
| 3   | Consistency fixes                                | `BulkActionBar.tsx`, `BulkActionBar.module.css`, `TaskItem.tsx` (hint only)                                                                                                                                                                                                                             | No    | `BulkActionBar` uses `ConfirmDialog`; task rows get a first-run swipe hint on their own storage key.                                                                                                                                                                                                                                                                             |
| 4   | Due date / recurrence mobile treatment           | `DueDateControl.tsx`, `RecurrenceEditor.tsx` (+ CSS if the decision calls for it)                                                                                                                                                                                                                       | Yes   | A wireframe is reviewed and a decision is recorded; code changes (if any) match that decision exactly.                                                                                                                                                                                                                                                                           |
| 5   | **[Platform repo]** Footer left-action mechanism | `packages/manifest/src/schema.ts`, `packages/ui/src/components/Icon/Icon.tsx` (+ `packages/ui/src/index.ts`), `runtime/src/registry.ts`, `runtime/src/mobile-chrome.ts`, `runtime/middleware.ts`, `runtime/app/(platform)/layout.tsx`, `MobileNav.tsx`, `ClientShell.tsx`, `docs/plugin-development.md` | Yes   | Any `shell: default` plugin can declare `shellConfig.mobileFooterLeftAction`; the resolved icon/label/href renders in the shared mobile footer's left slot while that plugin is active, with Home relocated to that plugin's Drawer as its first item; visibility-crossing refresh logic (`ClientShell`) covers it the same way it already covers `mobileHeader`/`mobileFooter`. |
| 6   | **[This repo]** Tasks consumes the mechanism     | `manifest.json`, `app/_components/MobileTasksCarousel.tsx`                                                                                                                                                                                                                                              | No    | Tasks' manifest declares `mobileFooterLeftAction`; tapping the footer's left icon while in Tasks lands deterministically on the Lists slide (carousel index 0), refresh-safe, without disturbing bare `/tasks`'s existing cold-load behavior.                                                                                                                                    |

Each leg is one branch, one draft PR, one review gate. The agent runs
uninterrupted within a leg and stops at its end, per the platform's leg
contract (`docs/workstreams/README.md` in the platform repo). Legs 5 and 6
are **cross-repo**: leg 5's branch/PR live in the platform monorepo
(`pods/p1` root), leg 6's in this plugin's own repo.

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

### Leg 5 — [Platform repo] Footer left-action mechanism

**Files:** `packages/manifest/src/schema.ts`,
`packages/ui/src/components/Icon/Icon.tsx` (+ `packages/ui/src/index.ts`),
`runtime/src/registry.ts`, `runtime/src/mobile-chrome.ts`,
`runtime/middleware.ts`, `runtime/app/(platform)/layout.tsx`,
`runtime/app/(platform)/_components/MobileNav.tsx`,
`runtime/app/(platform)/_components/ClientShell.tsx`,
`docs/plugin-development.md`

**Why this leg exists:** the mobile footer's left icon (currently hardcoded
"Home") is shared shell chrome, not owned by any plugin — there is no
sanctioned way today for a plugin to change what it does while that plugin is
active. Discovered mid-workstream while trying to make Tasks' left icon open
its own Lists slide instead of navigating away to the platform Launcher.

**Technical notes:**

- Mirrors the existing `shellConfig.mobileHeader`/`mobileFooter` (RFC 0075)
  plumbing end to end — same middleware→header→layout→component resolution
  path, same `MobileChromeOverride`/`mobile-chrome.ts` resolver pattern, same
  `ClientShell` refresh-on-crossing mechanism. Someone reading this leg's diff
  should recognize every file as "the same shape as the mobileHeader/
  mobileFooter change," not a new pattern.
- New manifest field: `shellConfig.mobileFooterLeftAction?: { icon: string;
label: string; href: string }`, `.strict()`, valid only when `shell` is
  `'default'` (a `.refine`, matching the existing `mobileHeader`/`mobileFooter`
  refines exactly).
- `icon` is **not** validated against a closed enum in the manifest schema
  (see Decisions locked — keeps `packages/manifest` free of a `packages/ui`
  dependency). Instead, export `ICON_NAMES = Object.keys(ICONS) as
IconName[]` from `packages/ui/src/components/Icon/Icon.tsx` (hand-maintained
  file, not the generated `icons/index.ts`) and re-export from
  `packages/ui/src/index.ts`. `MobileNav` checks the resolved icon name
  against `ICON_NAMES` and falls back to a safe default (`house`) with a
  dev-mode `console.warn` on a miss, rather than risking an undefined `Svg`
  render crash from an unrecognized name in a plugin's manifest.
- `runtime/src/registry.ts`: extend `MobileChromeOverride` with an optional
  `footerLeftAction`; broaden `getMobileChromeConfig`'s filter to also
  include a plugin that declares `mobileFooterLeftAction` even when its
  `mobileHeader`/`mobileFooter` are both left at their default `true` — the
  current filter only includes visibility-deviating plugins, which would
  silently drop a plugin that _only_ overrides the left icon.
- `runtime/src/mobile-chrome.ts`: add a `mobileFooterLeftAction(pathname,
config)` resolver returning the matched override or `null`, mirroring
  `mobileHeaderVisible`/`mobileFooterVisible`'s exact shape (same
  `underPrefix` matching).
- `runtime/middleware.ts`: when `currentPlugin?.shellConfig?.
mobileFooterLeftAction` is present, `JSON.stringify` it into a new request
  header (`x-sovereign-mobile-footer-left-action`), same spot as the existing
  `x-sovereign-mobile-header`/`-footer` header-setting.
- `layout.tsx`: read and `JSON.parse` that header (guarded — a malformed
  header must never crash the shell), pass the result as a new
  `footerLeftAction` prop to `<MobileNav>`.
- `MobileNav.tsx`: when `footerLeftAction` is present, render it as the sole
  `leftIcons` entry (replacing the hardcoded Home button) via `onClick` +
  `router.push` (matching the existing Home icon's own client-side-nav
  pattern, not a bare `href`/`<a>`) — **and** prepend a "Home" entry to the
  Apps Drawer's plugin grid, first item, only in this branch (see Decisions
  locked — not unconditional for every plugin).
- `ClientShell.tsx`: extend the pathname-crossing comparison to also diff
  `mobileFooterLeftAction(pathname, config)` between the previous and current
  pathname, forcing `router.refresh()` on a change — same reasoning as the
  existing header/footer-visibility diff (a client-side nav between two
  plugins with different configs must not keep rendering the previous
  route's already-resolved chrome).
- Docs: extend `docs/plugin-development.md`'s manifest reference table row
  for `shellConfig` and add a worked example alongside the existing "Mobile
  header/footer toggle (RFC 0075)" section — same doc, same section, not a
  new top-level heading, since this is an extension of that existing toggle
  family, not a separate concept.
- Version: platform root `package.json` minor bump (new manifest field +
  shell behavior = `feat`), with the usual narrated `CLAUDE.md` version note.

**Do not proceed if:** wiring the active plugin's `shellConfig` into
`MobileNav` turns out to need broader surgery than adding one prop through
the existing `layout.tsx`→`MobileNav` call — e.g. if `MobileNav` needs to
become aware of the full plugin registry rather than just the current route's
resolved override. If so, stop and re-scope rather than growing this leg into
a larger refactor of the mobile shell's data flow.

### Leg 6 — [This repo] Tasks consumes the mechanism

**Files:** `manifest.json`, `app/_components/MobileTasksCarousel.tsx`

**Why this leg is last:** blocked on leg 5 merging and releasing in the
platform monorepo (see Prerequisites) — nothing here is buildable until the
manifest field exists.

**Technical notes:**

- `manifest.json`: add
  `"shellConfig": { "mobileFooterLeftAction": { "icon": "menu", "label":
"Lists", "href": "/tasks?view=lists" } }`. Icon choice: the curated
  `@sovereignfs/ui` icon set (`packages/ui/src/components/Icon/icons/
index.ts`) has no dedicated "list" glyph — `menu` (hamburger) is the closest
  semantic fit without adding a new icon to the design system as a side
  effect of this leg (out of scope; flag as a follow-up if it reads poorly in
  practice).
- `MobileTasksCarousel.tsx`'s `indexForPathname`/`pathForIndex` currently
  only look at `pathname` — extend `indexForPathname` to also accept the
  parsed search params (already available via the component's own
  `useSearchParams()`) and recognize `view=lists` as index 0, distinct from
  bare `/tasks`'s existing "redirect to first list" cold-load fallback (see
  Decisions locked for why bare `/tasks` itself is not repurposed). Landing
  on index 0 this way must **not** trigger the `didSyncInitialUrl` cold-load
  effect (that effect only fires once, keyed off bare `/tasks` specifically,
  and should stay untouched).
- `pathForIndex(0, lists)` (used when the user _swipes_ to slide 0) stays
  returning bare `/tasks`, unchanged — this leg only adds a second, marker-
  URL entry point _into_ index 0; it does not change what URL a swipe settle
  produces. The two paths (`/tasks` via swipe-settle, `/tasks?view=lists` via
  the footer icon) both resolve to index 0 on load; only the swipe-settle one
  keeps its pre-existing "refresh lands you back on the first list" quirk
  (already documented, not something this leg touches).

**Do not proceed if:** nothing — this is a small, mechanical consumption of
an already-designed mechanism.

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
- Leg 5 is platform-repo work reviewed and released independently of this
  plugin — its version, changelog, and merge timeline are governed by the
  platform monorepo's own conventions, not this document. This workstream
  doc tracks it for continuity (it originated from this workstream's own
  leg-1 follow-up conversation) but does not control its release.
- Leg 6 has a hard dependency on leg 5's platform release actually reaching
  this plugin's `@sovereignfs/manifest`/`@sovereignfs/ui` versions — starting
  leg 6 against an unreleased leg 5 would fail at `pnpm install` or, worse,
  silently no-op if the manifest field is simply ignored by an older platform
  build rather than rejected.

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
- If leg 5's design turns out to need broader surgery than described (see
  that leg's own "do not proceed if"), it stops and is re-scoped as its own,
  separate platform-repo item — it does not block legs 1–4, which have no
  dependency on it. Leg 6 simply stays undone until leg 5 (in whatever
  eventual shape) actually ships.

## Changelog

| Version | Date        | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0.1     | August 2026 | Initial draft, from the mobile UI audit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 0.2     | August 2026 | Leg 1 implemented and manually verified (`feat/mobile-ds-primitive-migration-leg-1`, plugin `v0.16.1`). Dropped the old resize-realignment effect rather than reimplementing it against the DS component's public API — no imperative re-snap hook is exposed; noted as a known, accepted, cosmetic-only gap in the plugin's `CLAUDE.md` and this doc's Risks section instead of working around it with a DOM-reaching hack.                                                                                                                                                                                                                                                                                        |
| 0.3     | August 2026 | Added legs 5–6: a new cross-repo mobile-footer left-icon customization mechanism, prompted by wanting Tasks' footer left icon to open the Lists slide instead of the platform Launcher. Discovered mid-workstream that no such mechanism exists today (`shellConfig` only has `mobileHeader`/`mobileFooter` visibility booleans) and that the only precedent (`example-mobile-poc` self-rendering its own footer) would require duplicating shell-only chrome (the Apps drawer, the search overlay) not exposed to plugins — designed a generic, `mobileHeader`/`mobileFooter`-shaped manifest field instead, scoped as platform-repo work (leg 5) with this plugin's own consumption split into a dependent leg 6. |
