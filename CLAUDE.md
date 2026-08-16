# CLAUDE.md — sovereign-tasks

Guidance for Claude Code working in this plugin repository.

## What this is

**Sovereign Tasks** — a minimal, privacy-first task manager. A first-party
(`type: sovereign`) Sovereign plugin maintained in its own repository
(`sovereign-tasks`). The primary reference implementation for
externally-maintained Sovereign plugins.

Spec: [SPEC.md](SPEC.md)

## Identity

| Property     | Value                                                                              |
| ------------ | ---------------------------------------------------------------------------------- |
| Plugin ID    | `fs.sovereign.tasks`                                                               |
| Route prefix | `/tasks`                                                                           |
| Permissions  | `auth:session`, `db:readWrite`, `notifications:send`, `data:export`, `data:import` |
| Min platform | `0.19.0`                                                                           |
| Table prefix | `tasks_`                                                                           |

## SDK-only rule

**Never import from `@sovereignfs/db` directly.** All database access goes
through `sdk.db`. This is enforced by the platform's ESLint SDK boundary rule
and is the defining constraint of an externally-maintained plugin.

```ts
// ✅ correct
import { getSdk } from '@sovereignfs/sdk';
const sdk = getSdk();
const db = await sdk.db();

// ❌ wrong — breaks the plugin/platform boundary
import { getPlatformDb } from '@sovereignfs/db';
```

## tenant_id scoping

Every query that touches user data **must** filter by both `tenant_id` and the
current user's `id`. There is no exception. Failing to scope by `tenant_id`
leaks data across tenants in multi-tenant deployments.

```ts
// Every list query looks like this
const lists = await db
  .select()
  .from(tasksLists)
  .where(and(eq(tasksLists.tenantId, tenantId), eq(tasksLists.ownerId, userId)));
```

## Table prefix

All plugin tables are prefixed `tasks_`:

- `tasks_lists`
- `tasks_items`
- `tasks_views`
- `tasks_user_list_prefs`
- `tasks_notification_prefs`
- `tasks_list_members` (v0.2)

## Milestone scope

Requirement IDs are stable — never renumber or reuse a TSK-* id.

| Milestone | TSK IDs | Status  | Description                                                               |
| --------- | ------- | ------- | ------------------------------------------------------------------------- |
| v0.1      | 01–09   | shipped | Private lists, task/subtask CRUD, completion, sort                        |
| v0.2      | 10–14   | blocked | Collaboration — requires `sdk.directory` (sv-RFC 0041)                    |
| v0.3      | 15–21   | shipped | Due dates, overdue, filters, search, keyboard shortcuts, bulk delete/move |
| v0.4      | 22–25   | shipped | Recurrence via `rrule` (sv-RFC 5545) — nth-day-of-month deferred          |
| v1.0      | —       | future  | Polish, docs, reference implementation                                    |

**TSK-26 (star/favourite)** and **TSK-27 (move a task to a different list, from
the detail pane)** shipped ahead of phasing alongside the three-column web home.
**v0.4 (recurrence)** shipped out of order too, ahead of v0.3's remaining
keyboard-shortcut/bulk-action items, which followed in their own branch.
**TSK-28 (virtual "Starred" list)** and **TSK-29 (account-level data
portability)** shipped ahead of phasing too — TSK-28 builds on TSK-26; see
`roadmap.md` for per-requirement status.

**Do not start v0.2 work until `sdk.directory` is available (sv-RFC 0041).** Do not call
Console admin user routes as a workaround.

## UI rules

- Consume `@sovereignfs/ui` components and `--sv-*` tokens exclusively.
- Never hardcode colours, spacing, or radii — always reference tokens.
- **DS-first: this plugin is a consumer.** Never hand-roll reusable UI
  primitives here (interaction hooks, overlays, secondary headers, pickers) —
  they are added to `@sovereignfs/ui` in the platform repo and consumed from
  there. `MobileFullPageOverlay.tsx` and `_lib/doubleTap.ts` (hand-rolled
  local primitives that predated this rule) are gone, replaced by
  `@sovereignfs/ui`'s `Sheet`/`ConfirmDialog`/`Menu` and interaction hooks —
  see the platform repo's `docs/adhoc/mobile-design-system-improvement-plan.md`
  Phase C1. `_lib/useIsMobile.ts` is the one sanctioned exception: a thin
  wrapper binding this plugin's documented 640px threshold to the DS hook, not
  a reimplementation of it. Don't add new local overlay/menu/confirm-dialog
  siblings.
- **Three-column layout on web:** list sidebar (col 1) · task list (col 2) ·
  task detail (col 3). The detail pane is driven by the `?task=<id>` search
  param on `/tasks/[listId]`; it collapses below ~900px (tablet — no detail
  sheet substitute at this width; unchanged, low priority). Select a task via
  `<Link href="?task=id">`; close with `<Link replace href="/tasks/[listId]">`.
- **List management is split across double-click/double-tap and a col-2
  header menu, shared by desktop and mobile** (col 2's `⋯` menu is no longer
  desktop-only — see "Mobile shell"): double-clicking/double-tapping a list's
  title (col 1 sidebar row or col 2 header) renames it; double-clicking the
  colour dot opens just the swatch picker (desktop only — mobile's dot is a
  plain indicator, colour lives in the sidebar's own combined rename+colour
  drawer instead). "Sort by" (Manual/Date created/Due date/Title A-Z,
  client-side only — not persisted, resets on navigation like the `filter`
  control), "Delete completed tasks" (bulk-deletes every completed task in
  the list via `bulkDeleteTasks`, shown only when the list has at least one;
  confirms via the same native `<dialog>` pattern as Delete list), and
  Delete list live in a `⋯` menu at the end of col 2's header, after the
  Filter control (folded into the same menu when Filter itself doesn't fit
  inline next to the title). Colour is the one sanctioned splash in the
  monochrome UI — the fixed swatch set is in `app/_lib/colors.ts`; it renders
  only as the small list dot.
- **Drag-reorder is disabled whenever Sort by isn't Manual.** Dragging while
  the list displays a derived order would compute the wrong move — dnd-kit
  only sees the sorted view's index positions, not the underlying manual
  `sortOrder` — so `TaskItem`'s drag handle is hidden (`dragDisabled` prop)
  and `TasksPane`'s `handleDragEnd` no-ops in that state.
- **Mobile (≤640px) is a different UI, not a squeeze of the desktop one** —
  see "Mobile shell" below.
- **Starred is virtual — never a `tasks_lists` row** (TSK-28). `STARRED_LIST_ID`
  (`app/_lib/virtualLists.ts`) is a reserved pseudo-id (`'starred'`), safe
  because real list ids are UUIDs. It's rendered as a pinned sidebar row and a
  route (`/tasks/starred` desktop, a synthetic carousel slide on mobile) that
  reuse `TasksPane` in a stripped-down `virtualList="starred"` mode — never a
  forked component — so real-list behavior (filter, sort, complete, detail,
  move) stays in sync for free. Don't add a `tasks_lists` row, migration, or
  per-list prefs for it.

### Views

One data model, multiple presentations. Views are a lens — never a fork of the
task/completion model.

| View           | `kind`           | Status |
| -------------- | ---------------- | ------ |
| Compact        | `compact`        | v0.1   |
| Kanban Compact | `kanban_compact` | future |
| Kanban         | `kanban`         | future |
| Visualizer     | `visualizer`     | future |

v0.1 renders the Compact view only. Future views are additive and must not
require changes to `tasks_items` ownership or completion columns.

## Drag reorder

Uses `dnd-kit` (`@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`).
**Not** `packages/ui`'s `DragHandleRow` — that component reserves a fixed-width
gutter before the row's content, which couldn't be made to align with the
header/add-row indent above it. Both list rows (`ListSidebar.tsx`) and task
rows (`TaskItem.tsx`) instead use a shared `GripIcon` as a custom, absolutely-
positioned floating handle that occupies no layout space until hovered.
`useSortable`'s `attributes`/`listeners` spread directly onto that button.
Every `DndContext` on the page needs an explicit `id` prop — without one,
dnd-kit's auto-incrementing `aria-describedby` IDs aren't guaranteed to match
between SSR and hydration when multiple `DndContext`s are mounted (which this
plugin always has: one for lists, one for tasks).

**Long-press/press-and-drag anywhere on the row lifts it** (v0.12, extended to
desktop mouse in v0.12.2 — see below), not just the handle —
`app/_lib/dndSensors.ts`'s `useReorderSensors()` swaps the old single
`PointerSensor` for `MouseSensor` (`distance: 8`) + `TouchSensor`
(`delay: 300, tolerance: 8`) + `KeyboardSensor`. Both custom sensor subclasses
refuse to activate when the touch/click originated inside an element marked
`data-no-dnd` (checkbox, star, subtask ring, swipe edge zones, list ⋯ button,
the desktop colour-swatch trigger — see `shouldHandleDndEvent`), so those
controls keep their own tap behavior instead of lifting the row. On task rows
specifically, a touch lift released back in place (delta < 12px) toggles
bulk-select instead of reordering — see "Keyboard shortcuts and bulk select"
below.

**Both row types forward `listeners` onto the whole row, unconditionally, on
every breakpoint** (v0.12.2) — `ListSidebar.tsx`'s `ListItem` spreads them
onto `.rowInner`; `TaskItem.tsx` spreads them onto `.row` whenever
`!dragDisabled`. Press-and-drag from anywhere on a row works via mouse or
touch on both. This was originally mobile/touch-only, keeping desktop
mouse-drag handle-only — but the ~12px hover-revealed handle (opacity 0 until
`:hover`) turned out too easy to miss entirely on desktop for both row types,
and since `MouseSensor`'s own `distance: 8` activation constraint already
keeps an ordinary click (rename, navigate, checkbox, open the colour picker)
from being mistaken for a drag, there's no narrow-desktop-window trade-off to
guard against — `isMobile` gating was never actually load-bearing for safety,
just an initial (overly conservative) scope choice.

**The handle's own hover-reveal had a separate, pre-existing bug**: it never
actually became visible on hover, on either row type, at any point before
v0.12.2 — `.dragHandle`/`.dragHandle` (ListSidebar/TaskItem) sits _before_
`.rowInner`/`.row` in the DOM, and that later sibling has an opaque
(inherited) background with no `z-index` of its own on desktop; two
positioned siblings with no z-index difference paint in DOM order, so the
opaque row always covered the handle regardless of its own `opacity`. Fixed
with an explicit `z-index: 4` on both `.dragHandle` rules, higher than every
other value in that row's stacking context. Not a regression from this
feature — just never noticed until whole-row drag made desktop dragging a
discoverable, expected interaction worth actually looking for the handle.

**Task reorder must compute indices against `activeVisible`, never raw
`tasks`** — `TasksPane.tsx`'s `handleDragEnd`. dnd-kit's `SortableContext` for
task rows is seeded with `activeVisible.map(t => t.id)` — the actually
_rendered_ order — and `activeVisible` always runs `tasks` through
`pinDueTodayAndOverdue` on top of `sortTasks`, even under `sortBy: 'manual'`
(due-today/overdue tasks are pinned first regardless of sort mode). `active`/
`over` from a `DragEndEvent` are positions within that rendered array, not
raw `tasks`'s own manual order — computing `oldIndex`/`newIndex` directly
against `tasks` (the original implementation) silently desyncs the two
whenever any visible task is pinned, producing a no-op or a wrong swap. This
was a latent bug present before whole-row drag ever shipped; it just never
got exercised, since the only way to drag before v0.12.2 was via the
(separately broken, invisible) handle. Fixed by computing indices against
`activeVisible`, reordering that subset, then re-splicing it back into the
full `tasks` array by walking `tasks` in its original order and substituting
each visible-subset member's id with the next id from the reordered subset —
this preserves the position of everything dnd-kit never saw (completed
tasks, tasks hidden by the current filter). One consequence worth knowing:
dragging a pinned (due-today/overdue) task, or dragging _relative to_ one,
can look like a no-op — pinning always wins the _rendered_ position
regardless of the new manual order underneath it, so the visible list may
not change even though the persisted order did. This is correct, expected
behavior, not a bug to chase.

## Recurrence

Uses `rrule` (sv-RFC 5545) — see `app/_lib/recurrence.ts`. **`rrule` operates
on UTC internally.** Constructing its `dtstart` (or any date passed to
`.after()`) from a _local_ `new Date(y, m, d)` silently shifts which weekday
matches a `byweekday` rule by one day on servers with a positive UTC offset —
verified empirically (a Tuesday `dtstart` built with `new Date(2026, 6, 7)`
produced a Tue/Thu/Sat sequence for a Mon/Wed/Fri rule instead of Mon/Wed/Fri).
Every date crossing the rrule boundary in `recurrence.ts` goes through its own
`parseUTC`/`toISODateUTC` helpers — never this plugin's own local-date helpers
in `date.ts`, which are correct for UI display but wrong for rrule interop.
Stored `recurrence_rule` strings never embed `DTSTART` — a task's own
`due_date` is always the anchor, supplied at computation time.

## Due/overdue notifications (v0.11)

`app/_jobs/due-reminders.ts` is a platform-scheduler handler (manifest
`schedules` entry, sv-RFC 0046 Phase 1, invoked every minute) that sends two
notification kinds per opted-in user via `sdk.notifications.send`: a
once-per-local-day **morning digest** (tasks due today + overdue, at the
user's chosen `morning_time`) and a **due-time reminder** per task whose
`due_time` arrives today. Everything is computed in the user's stored IANA
timezone (`tasks_notification_prefs.timezone`, captured from the browser on
every prefs save — see `NotificationSettings.tsx`, the bell in the list
sidebar header). **Every send is gated behind a conditional-UPDATE claim**
(`last_digest_date` on the prefs row; `reminder_sent_at` on the task row)
because the scheduler gives no delivery guarantees — restarts re-arm it and
replicas tick independently. `setDueDate` clears `reminder_sent_at` so
rescheduling re-arms the reminder; never change due date/time through another
path without doing the same. Timezone math lives in `app/_lib/tz.ts` —
**never reuse `date.ts` (server-local, UI display) or `recurrence.ts`'s UTC
helpers (rrule interop) for user-local scheduling decisions.** Editing the
handler requires a dev-server restart (composed at generate time, imported at
startup — no HMR).

## Data portability (v0.14, TSK-29)

`app/_lib/portability.ts` registers this plugin's export/import/delete
participation in the platform's account-level data portability flow (RFC
0007 export/import, RFC 0033 deletion) — reached from **Account → Export my
data / Import my data**, not a plugin-local button. Registered from
`app/layout.tsx` (best-effort, in-process, resets on restart — same pattern
as every other request-scoped SDK registration). Mirrors
`sovereign-plainwrite`'s own `app/_lib/portability.ts`.

- **Export** (`exportTasksData`): every list the user owns, plus its items,
  views, and user-list-prefs, plus the user's own (list-independent)
  `tasksNotificationPrefs` row. Direct Drizzle queries scoped by
  `tenantId`+`ownerId` — not the UI-shaped functions in `actions.ts`, which
  add derived fields (`openCount`, subtask counts) that don't belong in a
  storage format.
- **Import** (`importTasksData`): **additive — never wipes existing data.**
  Every plugin-owned id (`tasksLists.id`, `tasksViews.id`, `tasksItems.id`,
  its own `parentId` for subtasks, and `seriesId` — not a literal FK, just a
  grouping value, but remapped the same way so an imported recurring series
  stays linked to itself) goes through `ctx.remapId()`, whose per-import
  stability (same original id → same new id, every call) means no local id
  map needs to be hand-maintained here. A row whose `listId`/`parentId`
  doesn't actually appear in this export is skipped, not hard-failed — see
  the `originalListIds`/`originalViewIds`/`originalItemIds` checks. **One
  deliberate exception to "additive":** `tasksNotificationPrefs` is a
  per-user singleton (its PK is `tenantId`+`userId`, not a plugin-minted
  id), so a second import into the same account would collide on that PK —
  it's seeded only when the account doesn't already have a row, never
  overwritten.
- **Delete** (`deleteAllTasksData`, RFC 0033): re-implements `deleteList()`'s
  own per-list cascade (`actions.ts`) rather than calling it — that function
  authorizes via a live session (`getContext()`), which an account-deletion
  flow doesn't have (`ctx.userId`/`ctx.tenantId` are supplied directly).
- **Manifest permissions**: `data:export` + `data:import` gate participation
  (`runtime/src/portability/platform.ts`'s `eligiblePluginIds`) — deletion
  handlers aren't gated by a manifest permission at all, any registered
  deleter runs unconditionally on account deletion.

## Keyboard shortcuts and bulk select

TSK-19–21, in `TasksPane.tsx`/`TaskItem.tsx`/`BulkActionBar.tsx`. Shortcuts
(`n` new task, `j`/`k`/Up/Down row focus, `e` complete, `Enter` open detail,
`[`/`]` previous/next list, `Escape` clears bulk selection) attach via a
`window` `keydown` listener in `TasksPane` and bail out whenever
`document.activeElement` is an `INPUT`/`TEXTAREA`/`SELECT` or
`isContentEditable`, or a modifier key is held — they must never fire while
the user is typing. Bulk select is entered via **ctrl/cmd-click or long-press
on a row**, not an explicit "Select" mode button — the row checkbox already
means "mark complete", so a mode toggle would either shadow that or require
two different checkbox meanings on the same element. On mobile, whenever a
reorder is possible (`sortBy === 'manual'`), the long-press hold is owned by
the drag sensor instead of `useLongPress` directly: moving the row reorders
it, releasing in place toggles selection — see "Drag reorder" above.
`useLongPress` stays the only path to bulk-select when `sortBy !== 'manual'`
(no valid reorder to compute there) or on desktop (ctrl/cmd-click only; no
long-press). Bulk delete/move go
through dedicated server actions (`bulkDeleteTasks`, `bulkMoveTasks` in
`actions.ts`) that operate on the whole id array in one query per table,
rather than looping the existing single-task `deleteTask`/`moveTask` — avoids
N round trips for an N-task selection.

## Mobile shell

Below 640px the plugin renders a **completely different component tree**, not
a CSS squeeze of the desktop one — `app/_lib/useIsMobile.ts`
(`matchMedia('(max-width: 640px)')`) is the only place in this codebase that
forks JS behavior on viewport, since nothing else needed to. `layout.tsx`
delegates to `app/_components/MobileAwareShell.tsx`, which on mobile mounts
`MobileTasksCarousel.tsx` instead of rendering `children` (page.tsx's
server-rendered output) at all.

- **Carousel model (workstream 0001 leg 1)**: `MobileTasksCarousel.tsx` renders
  through `@sovereignfs/ui`'s `SwipableMobileCarousel`, driven by
  `useCarouselRouteSync` — slide 0 is `ListSidebar` full-page (mobile
  equivalent of the sidebar), slide 1 is the virtual Starred view, slide _n_
  (n≥2) is `TasksPane` for `lists[n-2]`. The scroll-snap physics, settle
  detection, and pathname↔index sync that used to be hand-rolled here now
  live in the DS package (`useSnapCarousel`/`useCarouselRouteSync`) — this
  plugin only supplies `indexForPathname`/`pathForIndex` (the routing map)
  and the per-list task cache below. Landing at the bare `/tasks` route puts
  you on your **first list**, not the Lists index (matches the desktop
  sidebar+first-list both being visible at once); the index slide is reached
  only by swiping. **Mount-window caveat**: `SwipableMobileCarouselSlide`
  only keeps `activeIndex ± prefetchDistance` (default 1) _mounted_ — a slide
  more than one away unmounts its `TasksPane`/`ListSidebar` instance,
  resetting that instance's own ephemeral UI state (sort/filter selection,
  bulk selection, in-progress rename, scroll position) on remount. This
  matches desktop's existing behavior (switching `/tasks/[listId]` routes
  already remounts `TasksPane`) — it is not a regression from the old
  carousel's "never unmount once visited" behavior, it's a deliberate
  alignment with desktop.
- **Fully decoupled data, on purpose**: `MobileTasksCarousel` fetches every
  list's tasks itself via the existing `getTasks`/`getTask`/`getOrCreatePrefs`
  server actions (already callable straight from client code elsewhere in
  this plugin), caches them per `listId` in its own `listState`, and eagerly
  prefetches the immediate left/right neighbors on every index change — so a
  single swipe never shows a loading spinner. This cache is independent of
  `SwipableMobileCarouselSlide`'s mount window (above): once fetched, a
  list's tasks stay cached even after its slide unmounts, so revisiting it
  never re-fetches or spinners, only its transient UI state resets. This
  means `page.tsx`'s own server fetch for the routed list runs and is simply
  unused on mobile (its JSX is never rendered) — a deliberate, accepted
  redundancy that keeps `TasksPane`/`TaskDetailPane` completely unmodified
  and lets the carousel's cache survive route changes (a real prop-threaded
  alternative would force a remount on every swipe-triggered navigation,
  defeating the "no loading flash" point).
- **Loading slides keep their header (workstream 0001 leg 6)**: a cold load
  or a multi-slide jump (dot indicator, list-picker) can still land on a slide
  whose cache is genuinely empty — a single adjacent swipe never does (see
  above), but landing more than one slide away skips the prefetch. For that
  case, `SlideHeaderSkeleton` (in `MobileTasksCarousel.tsx`) renders while
  `listState[id].status === 'loading'`: a plain, non-interactive echo of
  `TasksPane`'s own title row (dot/star + title, no count/filter/menu — none
  of that is known yet) with `@sovereignfs/ui`'s `Spinner` centered below it
  in place of the task rows. Replaces the previous full-slide "Loading…"
  placeholder, which blanked the list name along with everything else.
  Deliberately not `TasksPane` itself mounted with an empty `initialTasks`
  array — that would flash a real "0 tasks"/empty-state body first, a
  different and worse jump than the one being fixed.
- **`router.refresh()` still works**: `MobileAwareShell` passes `children`
  through to the carousel as `refreshSignal` — not to render, purely as a
  signal. Every `router.refresh()` call already scattered through
  `TasksPane`/`TaskDetailPane`/etc. gives `children` a new identity, and the
  carousel's effect keyed on that reference re-fetches the active slide. This
  is _why_ none of those existing mutation handlers needed touching.
- **No orientation-resize realignment**: the old hand-rolled carousel had a
  `window` `resize` listener that re-snapped `scrollLeft` on orientation
  change; `SwipableMobileCarousel`/`useSnapCarousel` don't expose an
  imperative "re-snap to the current index" hook a consumer can call from
  outside, so this was dropped rather than reintroducing a local DOM-reaching
  workaround. A rotation may leave the scroll position fractionally
  off-boundary until the next swipe re-settles it — cosmetic, not a
  navigation bug (the active slide/URL stay correct). Worth a small upstream
  DS enhancement if it proves annoying in practice.
- **Task detail is `@sovereignfs/ui`'s `Sheet`** (no `title` — a task's own
  composite header, the checkbox + editable title + star + close row, is
  richer than `Sheet`'s built-in `OverlayHeader` can express, so the content
  supplies its own, same as it did under the plugin's own predecessor
  `MobileFullPageOverlay`) wrapping the unmodified `TaskDetailPane`,
  opened/closed by the same `?task=` param convention as desktop. `Sheet` has
  no scrim of its own — `TaskDetailPane` supplies its own close button, which
  must call `router.replace(closeHref, { scroll: false })` directly (not a
  `next/link` `<Link replace>`, which silently no-ops when only the search
  param changes on an already-mounted client route — this is what broke the
  mobile close button before it was fixed to call `router.replace`
  imperatively). Swiping to a different list slide also closes it, since a
  task's detail only makes sense tied to the slide it came from.
- **List management** (`ListSidebar.tsx`'s `ListItem`): mobile keeps a single
  combined "Edit list" `Sheet` (rename + colour; `Sheet`'s own `title` header
  this time, since the content here has no header of its own), reached via an
  explicit `⋯` button in the row's trailing region (decision D1 — this used
  to be a double-tap gesture on the title, which meant every single tap
  deferred navigation behind a double-tap detection window; single tap now
  navigates immediately). Desktop keeps its own split (double-click
  title/dot + a separate col-2 header menu, see "UI rules" above) —
  `useIsMobile()` gates which renders; both call the same handlers
  (`updateList`, `updateListColor`, etc.). **Delete confirmation is
  `@sovereignfs/ui`'s `ConfirmDialog`** at every breakpoint — replacing the
  native `<dialog>` this plugin's pattern was later promoted into the design
  system from (see that component's own doc comment).
- **Task rows** (`TaskItem.tsx`): mobile swipe-to-reveal (Done + Delete,
  edge-zone gesture — see the component's own comments) also gates its Delete
  button behind `ConfirmDialog`, same as list deletion — a swipe that lands
  too far can end the gesture directly on the Delete button with no
  intermediate confirmation otherwise, unlike the desktop detail pane's
  Delete button (a deliberate second, separate tap).
- **Reorder via long-press** (v0.12): both the Lists slide (slide 0) and task
  rows are drag-reorderable on touch now, not just via the hidden hover-only
  handle — see "Drag reorder" above for the sensor/exclusion mechanism. The
  Lists slide's `.nav` also gained `height: 100%; overflow-y: auto` (mobile
  only) as a prerequisite — it previously had no scroll container of its own
  at all (the carousel `.slide` wrapping it is `overflow: hidden`), a latent
  bug that also silently capped how many lists were reachable on a long list.
- **Self-rendered mobile footer** (workstream 0001 leg 5): `manifest.json`
  sets `shellConfig.mobileFooter: false`, and `MobileTasksCarousel.tsx`
  renders its own `@sovereignfs/ui` `MobileFooter`/`MobileAppsDrawer` instead
  of the platform's. Left icon jumps to the Lists slide via
  `useCarouselRouteSync`'s `onSettle(0)` (not a navigation to bare `/tasks`,
  which already has its own cold-load meaning). Center Apps button opens a
  drawer populated from `sdk.plugins.list()` (called server-side in
  `layout.tsx` — that SDK method needs `next/headers`, so this client
  component can't call it itself) and uses the Launcher's own icon, matching
  the platform shell's `MobileNav` exactly. Right icon routes to this
  plugin's own `/tasks/search` instead of the platform's instance-wide
  search overlay, which isn't exposed to plugins. **The Launcher stays
  included in the drawer grid**, unlike the platform's own drawer (which
  excludes it in favor of its separate Home left icon) — this footer's left
  icon is repurposed for Lists, so the drawer is the only remaining way back
  to the Launcher; excluding it here would strand users. `.wrap` is a flex
  column (`.carouselArea` takes `flex: 1; min-height: 0`), not a plain
  block — the carousel already fills 100% of whatever height it's given, so
  without an explicit flex layout the footer after it gets pushed below the
  fold and clipped by the shell's own `overflow: hidden`, invisible rather
  than just misplaced (a real bug hit and fixed while building this).

## Versioning

This plugin follows its own semver, independent of the platform version:

- `fix/` → patch (0.0.x)
- `feat/` → minor (0.x.0)
- Breaking change → major (x.0.0)

Current version: **0.20.1** (`0.20.0` → `0.20.1` is Issue 7 of
`docs/data-fetching-and-mobile-interaction-findings.md` — attempting to
scroll up while already at the top of a list's task rows could visibly
detach the sticky list header from the content below it for a moment,
exposing blank space above the header. Root cause: `TasksPane.module.css`'s
`.pane` (the mobile scroll container for a list's task rows) had no
`overscroll-behavior` set, and neither did any other scroll container in
the plugin. The platform shell's own `overscroll-behavior: none` on
`html, body` only suppresses the _document's_ rubber-band bounce — iOS
Safari applies elastic overscroll independently to every scrollable
element, so `.pane` still rubber-banded on its own; since `.stickyHeader`
lives inside `.pane`, an elastic bounce at `scrollTop: 0` could visually
drag it down along with the bounced content. Fixed by adding
`overscroll-behavior-y: contain` to `.pane`, matching the same treatment
`@sovereignfs/ui`'s own internally-scrolling components (`Sheet`, `Drawer`,
`ScrollArea`, `MessageScroller`) already give themselves. Applied the same
containment to two other touch-reachable scroll containers found in the
same audit: `ListSidebar.module.css`'s `.nav` (the mobile Lists-index
carousel slide) and the small dropdown menus in `BulkActionBar.module.css`/
`ListPickerControl.module.css` (no sticky child, so not the exact reported
symptom, but the same class of gap). Desktop-only containers
(`layout.module.css`'s `.sidebar`/`.content`, `[listId]/page.module.css`'s
`.detailCol`) were confirmed never reached via touch and left alone.
Verified live via `getComputedStyle` that both changed elements resolve
`overscroll-behavior-y: contain` — the actual bounce itself isn't
reproducible in this environment's Chromium-based tooling, same limitation
as the earlier sticky-header fixes; real-device confirmation is still
outstanding. `0.19.0` → `0.20.0` is Issue 1 of
`docs/data-fetching-and-mobile-interaction-findings.md` — a subtask cache
(module-level, keyed by parent task id) so `SubtaskList` no longer refetches
via `getSubtasks` on every expand/collapse toggle. `SubtaskList` is
conditionally mounted (`{expanded && <SubtaskList ... />}` in `TaskItem`),
so every collapse used to discard all fetched state and every re-expand —
even of the same task, moments later — repeated the full round trip.
Cache staleness reuses the component's own existing reload-trigger props
(`listId`/`parentCompletedAt`/`parentSubtaskCount`/`parentSubtaskDoneCount`)
as a signature: a cached entry is only served when today's signature
matches the one recorded at cache-write time, so every case that already
forced a reload before this cache existed still does (the parent's
completion cascading to subtasks, a sibling `SubtaskList` instance's own
mutation) — only a signature-preserving mount/unmount now serves from
cache. A local mutation (toggle/add/delete) updates the cache alongside its
own `load()` call, so a subsequent remount reflects it without a second
fetch. Verified live: expand → collapse → re-expand produced zero new
network requests (confirmed via the browser's own network log, not just
inferred), toggling a subtask then collapsing/re-expanding showed the
updated state with no extra fetch either. No automated test — this plugin
has no component-testing infrastructure (`@testing-library/react` isn't a
dependency; only lib-level `.test.ts` files exist), and adding that
capability was judged a larger, separate change than this fix warranted.
`0.18.7` → `0.19.0` reworks the self-rendered
mobile Apps drawer's contents and ordering (`app/layout.tsx`), reported live
as showing "Account" and "Launcher" as generic plugin tiles alongside
"Console" in whatever order `sdk.plugins.list()` happened to return. Account
is now excluded from the drawer entirely (reached via the platform shell's
own account menu, not duplicated here); the Launcher entry is relabeled
"Home" and always pinned first; Console is always pinned last; any other
installed sovereign/community plugin keeps its natural `sdk.plugins.list()`
order in between via a stable sort (`footerAppRank` in `app/layout.tsx`) — a
feature change to the drawer's actual navigation model, not a cosmetic
tweak, hence the minor bump rather than a patch. `0.18.6` → `0.18.7` extends the same
`translateZ(0)` compositing-layer fix from `TaskItem.module.css`'s
`.rowContainer` (0.18.5) to the plugin's other three `position: sticky`
elements, reported live as a large empty gap opening up above the list
content during a fast scroll — `TasksPane.module.css`'s `.stickyHeader`,
`TaskDetailPane.module.css`'s `.top`, and `BulkActionBar.module.css`'s `.bar`.
Same root cause (WebKit's momentum-scroll re-tiling can leave a
non-compositing sticky element stale/blank for a stretch of frames instead of
repainting at its stuck position), applied by direct analogy rather than a
fresh live reproduction — that class of bug isn't reliably reproducible in
this environment's Chromium-based tooling, only confirmed live on a real iOS
Safari session for the original `.rowContainer` case. Verified the CSS rule
itself is live (`getComputedStyle` on `.stickyHeader` resolves `transform` to
`matrix(1, 0, 0, 1, 0, 0)`), not that the underlying jank is empirically gone.
`0.18.5` → `0.18.6` fixes the mobile Apps
drawer and task-detail sheet both getting their bottom edge clipped by this
plugin's own self-rendered `MobileFooter`, reported live as "Drawer has
broken" (the Account/Console/Launcher row cut off) and "task edit screen
content not scrollable" (the Delete button/List picker unreachable — not
actually a scroll bug). Root cause: `@sovereignfs/ui`'s `Sheet`/`Drawer`
both size their panel against `--sv-shell-footer-height` so it stops above
the footer instead of sliding underneath it — a variable the _platform_
shell sets for its own `MobileNav`, but this plugin opts out of that
(`shellConfig.mobileFooter: false`) and renders its own footer instead,
which the platform has no way to know the height of. The variable was
never set, both overlays fell back to `bottom: 0` (full viewport), and
since the footer's own `z-index: 101` beats the overlays' `100`, the
footer visibly covered their last ~60px. Fixed by measuring the
self-rendered footer's real height (`getBoundingClientRect()` in a
`useLayoutEffect`, plus a `resize` listener for orientation changes —
varies by device via `env(safe-area-inset-bottom)`, so not hardcoded) and
setting `--sv-shell-footer-height` on the plugin's own wrapping element,
which cascades to `Sheet`/`Drawer` via normal DOM inheritance regardless of
their `position: fixed`. **First attempt used `ResizeObserver` instead —
never fired even once**, in either the browser preview or a real WebKit
iOS Simulator session, for reasons not fully root-caused; switched to a
direct synchronous measurement instead, which worked immediately.
Verified live end-to-end: both overlays' panels now stop exactly at the
footer's top edge (`bottom: 751` in a 812px-tall viewport with a 61px
footer), confirmed via `elementFromPoint` at the boundary landing on the
overlay's own content, not the footer. `0.18.4` → `0.18.5` strengthens `TaskItem.module.css`'s
`.rowContainer` fix for the swipe-actions flash during fast vertical scroll,
reported live as still visible after `overflow: hidden` alone: that clips
this element's own painted content but doesn't stop a stale raster tile from
the scrolling ancestor showing through for a frame — a tiling quirk, not a
stacking-order one. Added `transform: translateZ(0)` to promote the row to
its own compositing layer, rasterized independently of the scroller's tile
grid. See `docs/ux-improvement-plan.md` Task 13's correction for the related
carousel investigation this surfaced alongside. `0.18.3` → `0.18.4` adopts `@sovereignfs/ui`'s
new `SwipableMobileCarouselDots` `density="compact"` prop (platform
`packages/ui` `0.56.0`) for the mobile list-switcher dots: halves the gap
between dots (`--sv-space-2` → `--sv-space-1`), since an instance with more
than a handful of lists (12 in the reproducing case — Lists index + Starred +
10 real lists) showed roughly 328px of dots in a 375px viewport. Only the
gap changes; each dot keeps its own 20px hit target. `MobileTasksCarousel.tsx`
now supplies its own `renderIndicator` forwarding the prop, instead of
leaving it `undefined` for the DS default — the DS itself defaults to
`'default'` density, so this had to be an explicit opt-in here, not a
shared-default change (`sovereign-shopper`, the DS's other named consumer of
this component, is unaffected). Verified live: confirmed via the DOM that
the `dotsCompact` class applies and the computed gap drops from 8px to 4px
with all 14 dots still rendering. See `docs/ux-improvement-plan.md` Task 11
for the full investigation. `0.18.2` → `0.18.3` fixes add-task appearing to
do nothing on mobile: typing a task and pressing Enter didn't clear the
input, update the count, or show the row until some unrelated navigation
happened to re-render the list — the task was actually being created the
whole time. Root cause was not a missing optimistic update:
`TasksPane.tsx`'s `handleAddTask` already had one (`useOptimistic`, same
mechanism `toggleComplete`/star use), but that overlay is discarded the
moment its enclosing transition settles, reverting to whatever
`initialTasks` prop is current at that point. On desktop `router.refresh()`
re-runs `page.tsx` synchronously with the transition, so fresh
`initialTasks` is ready in time; on mobile, `MobileTasksCarousel` keeps its
own decoupled task cache and only re-fetches asynchronously in response to
`refreshSignal`, so the transition settles (discarding the optimistic
overlay) before that refetch delivers the new task — the exact class of bug
`onTaskFieldPatch` (toggle/star) already exists to prevent, just not
extended to the add path. Fixed with a new `onTaskAdded` prop on
`TasksPane`, called synchronously alongside the optimistic dispatch, and a
matching `addTask` callback on `MobileTasksCarousel` that patches its own
cache immediately. Verified live: count updated 16 → 17 instantly with no
reload, and the new row was independently confirmed as a real (non-optimistic-id)
database row afterward. See `docs/ux-improvement-plan.md` Task 9 for the
full account. `0.18.1` → `0.18.2` fixes a duplicate
server-action burst on mobile: loading a list page fired ~10 near-identical
`getTasks`/`getOrCreatePrefs`/`getStarredTasks` calls instead of the expected
5 (active slide + 2 neighbors). Root cause: `MobileTasksCarousel.tsx`'s
`loadList` had no in-flight/loaded guard — its only guard
(`if (!listState[id]) loadList(id)`, in the mount-prefetch effect) reads
`listState` from that effect instance's own stale render closure, so React's
dev-mode Strict Mode double-invoking the mount effect fired every real fetch
twice. Fixed with a `loadingIdsRef` (`useRef<Set<string>>`) checked
synchronously at the top of `loadList`, set before the fetch and cleared in a
`finally` — guards every caller (the mount effect and the `refreshSignal`
re-fetch effect) against overlapping calls for the same list, without
changing when a settled list is allowed to refetch. Verified live: request
count on a fresh list load dropped from ~10 to the expected 5. See
`docs/ux-improvement-plan.md` Task 7 for the full account, including two
related findings from the same investigation that turned out **not** to be
carousel bugs: what looked like every list being mounted off-screen
simultaneously was actually `TasksPane.tsx`'s legitimate hidden
Filter-measurement clone matching the same DOM query, and a separate
`sdk.db.getClient()` platform bug (fixed in the platform repo, no plugin
code change — see that task's write-up) that was making the unrelated
`due-reminders` scheduler fail every tick. `0.17.0` → `0.18.0` is workstream 0001 leg 6 — the
mobile carousel's list header (title + colour dot/star) now stays on screen
while a slide's tasks are still loading, instead of the whole slide going
blank behind a centered "Loading…" placeholder. `MobileTasksCarousel.tsx`'s
`SlideHeaderSkeleton` renders a plain, non-interactive echo of `TasksPane`'s
own title row (dot/star + title only — no count/filter/menu, none of that is
known yet) while `listState[id].status === 'loading'`, with `@sovereignfs/ui`'s
`Spinner` centered below it in place of the task rows; swapped for `TasksPane`'s
own real header the moment loading finishes. Deliberately not implemented by
mounting `TasksPane` itself with an empty `initialTasks` array — that would
flash a real "0 tasks"/empty-state body before the actual data replaces it,
a different and worse jump than the one being fixed. Verified with a
temporary artificial delay in `getTasks` (reverted before commit): polled the
DOM every 150ms across a multi-list load and confirmed the header's title
text (`Groceries`, `Work`) never disappeared for the full ~2.4s window. `0.16.1`
→ `0.17.0` is workstream 0001 leg 5 —
the mobile footer's left icon now opens the Lists slide instead of doing
nothing plugin-specific; a real feature, not a refactor, hence the minor
bump rather than a patch. `shellConfig.mobileFooter: false` plus a
self-rendered `@sovereignfs/ui` `MobileFooter`/`MobileAppsDrawer`
(`app/_components/MobileTasksCarousel.tsx`), not a platform change — an
earlier version of this leg added a new manifest field
(`shellConfig.mobileFooterLeftAction`) and shell-side plumbing in the
platform monorepo, which turned out to be unnecessary and was reverted
(never merged) once `example-mobile-poc`'s own self-rendered footer showed
the existing `mobileHeader`/`mobileFooter` toggle was already sufficient.
`layout.tsx` now calls `sdk.plugins.list()` (server-side; that SDK method
needs `next/headers`) and passes the result down for the drawer — the
Launcher's own icon is used for the center Apps button (matching the
platform shell's `MobileNav` exactly) and Launcher is deliberately **not**
excluded from the drawer grid the way the platform's own drawer excludes it:
that exclusion only works there because the platform footer keeps a
dedicated "Home" left icon separate from Apps — this footer's left icon is
repurposed for "Lists", so the drawer is the only remaining way back to the
Launcher. `0.16.0` → `0.16.1` is workstream 0001 leg 1 — the
mobile carousel migrated from a hand-rolled scroll-snap/settle/pathname-sync
implementation to `@sovereignfs/ui`'s `SwipableMobileCarousel` +
`useCarouselRouteSync`, per `docs/workstreams/0001-mobile-ds-primitive-migration.md`.)

## Running locally

The plugin is mounted into the Sovereign platform during development. From the
platform monorepo root:

```bash
pnpm dev   # starts runtime on :3000; plugin routes are available at /tasks
```

When porting to the standalone `sovereign-tasks` repo, the plugin is
installed via `sv plugin add` and the platform hot-reloads it.

## Open questions (from spec)

1. **List color palette** — ✅ Resolved & shipped. Fixed set of `--sv-*` swatches
   (`LIST_SWATCHES` in `app/_lib/colors.ts`), not arbitrary hex.
2. **Assignment notifications** — out of scope v1; data model must not preclude it.
3. **Google Tasks import** — out of scope v1; v1.1 candidate.
