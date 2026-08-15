# UX improvement plan — bundled tasks

A bundled batch of UX tasks surfaced while dogfooding Sovereign Tasks. Most
target this plugin; some land in the platform monorepo (marked per task —
each repo gets its own branch/PR regardless). Each task is planned here first,
then implemented; one branch/PR may cover several tasks when they touch the
same surfaces in the same repo. Add new tasks as numbered sections; statuses:
**planned** · **in progress** · **shipped** · **dropped**.

| #   | Task                                                                      | Repo                                                     | Status                        |
| --- | ------------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------- |
| 1   | Long-press drag-reorder (lists page + task rows)                          | sovereign-tasks                                          | shipped ✅                    |
| 2   | Mark notifications read on click (bell panel)                             | **platform** (`sovereignfs/sovereign`)                   | shipped ✅                    |
| 3   | Virtual "Starred" list (all prioritized tasks in one view)                | sovereign-tasks                                          | shipped ✅                    |
| 4   | Per-plugin push notification icon                                         | **platform** (`sovereignfs/sovereign`)                   | shipped ✅                    |
| 5   | JSON export/import (account-level data portability)                       | sovereign-tasks                                          | shipped ✅                    |
| 6   | Sticky list header + add-task row while scrolling                         | sovereign-tasks                                          | shipped ✅                    |
| 7   | De-dupe `loadList` to stop duplicate server-action bursts on mobile       | sovereign-tasks                                          | shipped ✅                    |
| 8   | Fix `sdk.db.getClient()` returning the platform DB from schedule handlers | **platform** (`sovereignfs/sovereign`)                   | shipped ✅ (draft PR)         |
| 9   | Fix add-task appearing to do nothing on mobile                            | sovereign-tasks                                          | shipped ✅                    |
| 10  | Investigate task-detail click race (wrong/no detail opens)                | sovereign-tasks                                          | closed — not a bug            |
| 11  | Tighten `SwipableMobileCarouselDots` spacing for many-list instances      | **platform** (`sovereignfs/sovereign`) + sovereign-tasks | shipped ✅                    |
| 12  | Fix invisible carousel dots; investigate swipe instability + header load  | **platform** (`sovereignfs/sovereign`)                   | partially shipped — see below |

---

## Task 1 — Long-press drag-reorder (lists page + task rows)

**Status:** shipped ✅ — implemented and documented in the plugin's own `CLAUDE.md`
("Drag reorder", v0.12/v0.12.2: whole-row `MouseSensor`/`TouchSensor` listeners,
`data-no-dnd` exclusion, `activeVisible`-relative index fix). This plan's own
status table was stale; corrected here.

### Problem

On mobile there is no way to reorder lists or tasks. This is deliberate legacy:
both row types use dnd-kit with a hover-revealed grip handle, and under
`@media (hover: none)` the handle is `pointer-events: none`
(`ListSidebar.module.css`, `TaskItem.module.css`) so an invisible corner can't
capture scrolls. The fix is long-press-to-drag on both the Lists page rows and
task rows.

**Decision (confirmed):** on task rows — where long-press currently toggles
bulk-select (TSK-20/21) — the gesture becomes _lift on hold_: moving reorders;
releasing without moving toggles bulk-select (same outcome as today, confirmed
at release instead of mid-hold).

### Current state (verified)

- **Sensors** (identical in both panes): `PointerSensor { distance: 8 }` +
  `KeyboardSensor` — no delay/touch activation (`TasksPane.tsx` ~158,
  `ListSidebar.tsx` ~83).
- **Reorder plumbing already works end-to-end**: `handleDragEnd` → `arrayMove`
  → optimistic reducer + `reorderTasks(listId, ids)` / `reorderLists(ids)`
  server actions → `router.refresh()`. Nothing server-side changes.
- **Task drag gating**: `dragDisabled = sortBy !== 'manual'` (prop hides handle
  - disables `useSortable`; `handleDragEnd` also guards). The mobile ⋯ menu
    exposes Sort by, so this gating stays load-bearing on mobile. Lists are
    always manually ordered (no gating).
- **`useLongPress`** (`@sovereignfs/ui`): touch-only (`pointerType ===
'touch'`), 500 ms delay, 10 px tolerance, time-boxed click suppression,
  `navigator.vibrate(10)`. Used ONLY on TaskItem's main `<Link>` for
  bulk-select. ListItem doesn't use it.
- **Competing touch gestures**: swipe-to-reveal edge zones
  (`touch-action: pan-y`, z-index 2, manual pointer handlers with 8 px
  direction lock) on both row types; the horizontal scroll-snap carousel;
  vertical list scrolling.
- **Scroll containers**: TasksPane's `.pane` is `overflow-y: auto` (dnd-kit
  auto-scroll will find it). **The mobile Lists slide has NO vertical scroll
  container** — `.nav` has no height/overflow and the carousel `.slide` is
  `overflow: hidden`, so a long list of lists clips today (latent bug, must be
  fixed for auto-scroll anyway).
- **DS note**: nothing drag-related exists in `packages/ui`, and dnd-kit is a
  plugin-local dependency (sanctioned in CLAUDE.md). The sensor work stays
  plugin-local; nothing to promote.

### Design

#### Sensor split: MouseSensor + TouchSensor (per-input activation)

Replace `PointerSensor` in both panes with (via a new shared helper
`app/_lib/dndSensors.ts`):

- **`MouseSensor { activationConstraint: { distance: 8 } }`** — desktop
  behavior unchanged (handle-initiated, hover-revealed).
- **`TouchSensor { activationConstraint: { delay: 300, tolerance: 8 } }`** —
  the long-press lift. A finger that moves >8 px within 300 ms (vertical
  scroll, carousel swipe, edge-zone reveal) cancels activation and the native
  gesture proceeds; a still hold for 300 ms lifts the row.
- `KeyboardSensor` unchanged.

Both sensor classes are **subclassed with a target-exclusion activator** (the
standard dnd-kit pattern): activation is refused when
`event.target.closest('[data-no-dnd]')` matches. Mark: both swipe edge zones,
the list ⋯ options button, the task checkbox, star, subtask ring button, and
the list rename input. This prevents "long-press on the star lifts the row"
while leaving quick taps (<300 ms) on those controls untouched.

Delay/tolerance live as named constants at the top of `dndSensors.ts` — the
tuning knobs for real-device feel.

#### Listener placement (whole-row activation on mobile)

`useSortable`'s `listeners` currently spread only onto the hidden handle
button. Change in both `TaskItem` and `ListItem`: additionally spread
`listeners` onto the row container **only when `isMobile`** (the plugin's own
640 px `_lib/useIsMobile` hook, same one gating the swipe handlers).
`attributes` stay on the handle (desktop a11y unchanged); the handle keeps its
listeners so desktop is untouched. TouchSensor is the only sensor that can
activate from the row (MouseSensor needs the handle, since desktop rows never
get listeners).

#### Task rows: lift-on-hold, release = select

- In TasksPane's `handleDragEnd`: if the drag was touch-activated
  (`event.activatorEvent.type === 'touchstart'`) AND ended in place
  (`oldIndex === newIndex` and `Math.hypot(delta.x, delta.y) < 12`), call the
  existing bulk-toggle function with `active.id` instead of reordering. The
  delta guard keeps a real drag that returns home from toggling selection; the
  touchstart guard keeps desktop handle micro-drags out of it.
- `useLongPress` on the main `<Link>` gets
  `disabled: !onBulkToggle || (isMobile && !dragDisabled)` — the drag path owns
  the hold gesture when drag is possible; when sort is derived
  (`dragDisabled`), the hook stays active so bulk-select still works in
  non-Manual sort.
- Haptic parity: call `navigator.vibrate?.(10)` in `onDragStart` (guarded,
  touch-activated only) — matches `useLongPress`'s existing cue.
- **Verify-point (not assumed)**: dnd-kit suppresses the trailing click after
  an activated touch drag; if a click leaks to the `<Link>` after the
  release-toggles-select path, navigation would follow selection. If observed,
  add the same time-boxed click-suppression pattern `useLongPress` uses (set a
  `suppressUntil` ref in the drag-end toggle path, checked in
  `handleMainClick`).

#### Lists page: plain long-press drag

Same sensors + row listeners in `ListSidebar`/`ListItem`; `handleDragEnd`
unchanged apart from ignoring in-place touch drops (no select semantics — a
lift released in place is simply a no-op, and must not navigate). The existing
post-drop `document.activeElement` blur stays.

#### Mobile Lists slide scroll fix (prerequisite)

Scope to `@media (max-width: 640px)`: give `.nav` (`ListSidebar.module.css`)
`height: 100%; overflow-y: auto` so slide 0 scrolls at all — fixes the latent
clipping bug and gives dnd-kit auto-scroll an ancestor to drive during list
drags. Desktop `.nav` untouched (its column scrolls via the parent layout).

#### Lift affordance

Extend the existing `.dragging` class in both modules (currently just
`opacity: 0.5`): add `box-shadow` (DS token) and a raised background so the
lifted row reads as picked up on touch. No transform — dnd-kit owns the inline
transform.

### Files

| File                                                                 | Change                                                                                                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `app/_lib/dndSensors.ts` (new)                                       | MouseSensor/TouchSensor subclasses with `[data-no-dnd]` exclusion, tuning constants, shared `useReorderSensors()`                  |
| `app/[listId]/TasksPane.tsx`                                         | sensor swap; touch in-place drop → bulk toggle in `handleDragEnd`; vibrate on touch drag start                                     |
| `app/_components/TaskItem.tsx`                                       | row listeners when mobile; `useLongPress` disabled when `isMobile && !dragDisabled`; `data-no-dnd` on checkbox/star/ring/edge zone |
| `app/ListSidebar.tsx`                                                | sensor swap; row listeners when mobile; `data-no-dnd` on edge zone/⋯ button/rename input; in-place touch drop = no-op              |
| `app/_components/TaskItem.module.css` + `app/ListSidebar.module.css` | `.dragging` lift styles; ListSidebar mobile `.nav` scroll fix                                                                      |
| `CLAUDE.md` (Drag reorder + Mobile shell sections), `roadmap.md`     | document the new gesture + the select-on-release semantics                                                                         |
| `package.json`                                                       | feat → minor bump (confirm current version at implementation)                                                                      |

Unit test: the `[data-no-dnd]` exclusion predicate (pure function) in
`app/_lib/__tests__/dndSensors.test.ts`. The gesture itself is verified live —
jsdom can't express TouchSensor timing meaningfully.

### Verification

1. `pnpm dev`, mobile viewport (375 px), Chromium touch simulation: drive
   long-press-drag by dispatching `touchstart` → hold 350 ms → `touchmove`
   sequence → `touchend` on a task row; confirm the row lifts (`.dragging`
   styles), lands at the new index, and the order survives `router.refresh()`
   and a reload.
2. Release-in-place on a task row → bulk action bar appears (selection
   toggled), and **no navigation** to the task detail.
3. Repeat the drag on the Lists slide; confirm reorder persists; confirm a
   long list of lists now scrolls vertically (the `.nav` fix).
4. Regression sweep: swipe-to-reveal still works from the edge zones on both
   row types; carousel swipe between slides still works from row surfaces; tap
   still navigates; checkbox/star quick taps unaffected; Sort by ≠ Manual → no
   lift on task rows but long-press still bulk-selects; desktop hover-handle
   drag, ctrl/cmd-click select, and keyboard drag unchanged.
5. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test` from the
   platform root; version bump; draft PR.
6. Real-device pass (iOS): the delay/tolerance constants are the tuning knobs
   if the hold feels too eager/laggy — the one thing Chromium simulation can't
   prove.

---

## Task 2 — Mark notifications read on click (bell panel)

**Status:** shipped ✅ — implemented on `fix/notification-mark-read-on-click`.
**Repo:** platform monorepo (`sovereignfs/sovereign`) — this is runtime shell
chrome, not a tasks-plugin change. It lives in this document because the tasks
notification feature is what surfaced it. Branch type: `fix/` (runtime patch
bump).

### Problem

Clicking a notification in the bell panel navigates to its URL but **never
marks it read** — the unread dot and the bell badge persist until the user
explicitly hits "Mark all read", or dismisses the item. Reading a notification
and still seeing it counted as unread is misleading. Desired behavior: clicking
a notification marks it read (dot + badge clear); the item stays in the list
and can still be dismissed individually or via "Clear all" exactly as today.

### Current state (verified — the backend is 100 % ready)

- **Schema**: `notifications.read_at` / `dismissed_at` already exist with the
  right semantics (`packages/db/src/schema/*/platform.ts`; unread =
  `read_at IS NULL AND dismissed_at IS NULL`).
- **DB helpers**: `markNotificationRead`, `markAllNotificationsRead`,
  `dismissNotification` (dismiss also back-fills `read_at` via `COALESCE`) —
  `packages/db/src/platform-db.ts` ~1533.
- **API**: `POST /api/account/notifications` already supports
  `{ action: 'read', id }` (`runtime/app/api/account/notifications/route.ts:47-50`)
  — **implemented but unused by any UI today**. No schema, DB, or API changes
  are needed; this is purely a client-component gap.
- **The gap**: `runtime/app/(platform)/_components/NotificationBell.tsx` —
  the item title link (lines ~421-427) does only
  `<a href={item.url} onClick={() => setOpen(false)}>`. Items **without** a
  `url` render a plain `<span>` and can never be individually marked read at
  all. Existing panel actions: `markAllRead()`, `dismiss(id)`, `clearAll()` —
  all with optimistic local-state updates to copy the pattern from.
- **Styling**: the only read/unread visual is `.unreadDot`
  (`NotificationBell.module.css:309`); no differential item styling exists.

### Design (all in `NotificationBell.tsx` + its module CSS)

1. **New `markRead(id)` helper** modeled on the existing `dismiss(id)`:
   `POST { action: 'read', id }` with **`keepalive: true`** — the title link is
   a plain `<a href>` (full navigation, not a client-side route push), so a
   normal fetch would be aborted by the unload; `keepalive` lets the request
   survive it. Optimistic local update: set the item's `readAt`, decrement
   `unreadCount` (floor 0), skip entirely if already read.
2. **URL items**: in the anchor's `onClick`, call `void markRead(item.id)`
   before the existing `setOpen(false)`. Navigation proceeds normally.
3. **No-URL items**: replace the bare `<span className={styles.itemTitle}>`
   with a button-styled-as-text (`type="button"`, reuse `.itemTitle` styling,
   `aria-label` "Mark as read: <title>") whose click calls `markRead` and does
   NOT close the panel — there is nowhere to navigate, and closing would hide
   the feedback (dot disappearing) the click just produced. Already-read
   no-URL items render the plain span as today (nothing actionable).
4. **Read-state affordance (small CSS polish)**: unread items keep the dot;
   additionally render read items' title in `--sv-color-text-subtle` so the
   read/unread split is visible even mid-list. One new rule on `.itemTitle`
   gated by a `.itemRead` class on the `<li>`. No layout changes.
5. **Toasts, SSE, polling paths unchanged** — they already carry/refresh
   `readAt` on the next fetch; the optimistic update just makes it instant.
   `seenIds`/toast logic is untouched.

Deliberately NOT changing: auto-mark-read on opening the panel (the user
should be able to glance at the list without losing the unread markers), and
dismiss/Clear all semantics (explicit removal stays exactly as it is — that
was the user's stated requirement).

### Files

| File                                                             | Change                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `runtime/app/(platform)/_components/NotificationBell.tsx`        | `markRead(id)` helper (keepalive + optimistic update); wire into URL-item anchor click; button-ify unread no-URL titles; `.itemRead` class |
| `runtime/app/(platform)/_components/NotificationBell.module.css` | read-item title colour rule (reuse `.itemTitle`, add `.itemRead` modifier)                                                                 |
| `runtime/package.json` + root `package.json`                     | patch bumps (fix)                                                                                                                          |

No docs-parity impact (no manifest/SDK/env changes). No DB/API changes.

### Verification

1. `pnpm dev`, log in, generate notifications (e.g. via the tasks
   due-reminder flow or a test send), open the bell panel.
2. Click a notification **with** a URL → navigates; reopen the panel → that
   item's dot is gone, title is subtle-coloured, badge count decremented, item
   still present in the list. Confirm the `action: 'read'` POST fired
   (network tab / route logs) despite the navigation (keepalive).
3. Click an unread notification **without** a URL → dot clears in place, badge
   decrements, panel stays open, no navigation.
4. Regression: "Mark all read", per-item dismiss, and "Clear all" behave as
   before; toast-on-new-notification unchanged; badge count matches
   `countUnreadNotifications` after a hard reload (server truth agrees with
   the optimistic updates); SSE mode (set `NOTIFICATION_TRANSPORT=sse`) still
   inserts new items as unread.
5. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`; version
   bumps; draft PR against the platform repo.

---

## Task 3 — Virtual "Starred" list (all prioritized tasks in one view)

**Status:** shipped ✅ — implemented on `feat/virtual-starred-list`.
**Repo:** sovereign-tasks. Branch type: `feat/` (minor bump). Assigned
requirement id: **TSK-28** (builds on TSK-26 star/favourite —
add to `roadmap.md` when implemented).

### Problem

Starred/prioritized tasks (TSK-26) are scattered across lists — there is no
single view of everything the user has prioritized. Add a **virtual "Starred"
list** pinned as the first entry on the lists surface: it aggregates every
starred task across all the user's lists, but is _not_ a real list — no row in
`tasks_lists`, it owns no tasks, and tasks in it always remain in (and display)
their source list.

### Current state (verified)

- `tasks_items.favorite` boolean exists ([app/_db/schema.ts:87](../app/_db/schema.ts));
  `toggleFavorite(taskId, listId, favorite)` server action exists; `StarButton`
  renders in rows and the detail pane. All row interactions already operate on
  `task.listId` (not the pane's list), so cross-list rows work in an
  aggregated view without touching mutation plumbing.
- **Routing**: `/tasks/[listId]/page.tsx` 404s on unknown ids via
  `getTasks(listId)` + `lists.find(...)`. List ids are UUIDs, so a reserved
  slug can't collide. A **static segment beats the dynamic one** in Next.js —
  a dedicated `app/starred/page.tsx` needs no special-casing inside
  `[listId]`.
- **Mobile carousel** ([MobileTasksCarousel.tsx](../app/_components/MobileTasksCarousel.tsx)):
  slide 0 = Lists index, slide _n_ = `lists[n-1]`; per-list task cache keyed by
  `listId` via `loadList` → `getTasks`/`getOrCreatePrefs`; bare `/tasks` lands
  on the first real list.
- **TasksPane** takes `tasks` + `listId` + callbacks; add-row, ⋯ menu
  (rename/colour/delete/sort/delete-completed), filter, bulk-select, and
  drag-reorder all live there. `TaskItem` builds its detail href from
  `task.listId`.

### Design

**Reserved pseudo-id**: `app/_lib/virtualLists.ts` (new) exports
`STARRED_LIST_ID = 'starred'` + `isVirtualListId()`. UUID list ids guarantee
no collision.

**Data**: new server action `getStarredTasks()` in `_lib/actions.ts` —
tenant+owner scoped (hard rule), `favorite = 1`, top-level tasks joined with
`tasks_lists` for `listTitle`/`listColor` decoration on each row. Ordered by
due date (nulls last), then created. Subtask counts via the same aggregation
`getTasks` uses.

**Desktop route**: new `app/starred/page.tsx` mirroring `[listId]/page.tsx` —
sidebar + `TasksPane` in virtual mode + `TaskDetailPane` driven by `?task=`
(closing returns to `/tasks/starred`; the detail pane's List picker (TSK-27)
keeps working and moving a task does not remove its star).

**TasksPane virtual mode** (new optional prop `virtualList?: 'starred'`):

- Header: star icon + "Starred" title (not editable), count; ⋯ menu reduced to
  Sort by only — no rename/colour/delete-list/delete-completed. Filter control
  stays.
- **No add-task row** (a new task needs an owning list).
- **Drag-reorder always disabled** (no manual order exists across lists); Sort
  options exclude Manual, default **Due date**.
- Rows show a small source-list badge (colour dot + list name) — new optional
  `showListBadge` prop on `TaskItem`; row density otherwise unchanged.
- `TaskItem` gets an optional `detailBasePath` so detail links stay in the
  starred context (`/tasks/starred?task=<id>`) instead of jumping to
  `/tasks/<task.listId>`.
- Un-starring a row (or via its detail pane) removes it from the view on the
  existing `onMutated` → refresh cycle. Complete/reopen, bulk delete, and bulk
  move (targets are real lists) all work unchanged.

**Sidebar row** (`ListSidebar.tsx`): a pinned "Starred" row rendered above the
`DndContext` (not sortable, not swipeable, no ⋯/rename/colour) with a star
icon in place of the colour dot, the count of active starred tasks, and
active-state when `pathname === '/tasks/starred'`. Count comes threaded from
the page's `getStarredTasks()` (desktop) / the carousel cache (mobile) — or a
lightweight `countStarredTasks()` action if threading proves awkward; decide
at implementation.

**Mobile carousel**: insert a synthetic slide at index 1 (right after the
Lists index, before the first real list) — the "first list" position the user
asked for. `loadList` forks on `STARRED_LIST_ID` → `getStarredTasks()` (no
`getOrCreatePrefs` — virtual view has no per-list prefs row; `showCompleted`
defaults false, session-local toggle only). Bare `/tasks` still lands on the
first **real** list (unchanged landing behaviour); the starred slide is
reached by swiping right once, same as the Lists index. Slide-change
detail-close logic treats the starred slide like any other.

**Explicitly out**: no `tasks_lists` row, no migration, no persistence of the
virtual list's sort/filter (session-local, same as real lists' Sort control),
no changes to notifications/recurrence (both operate on real rows and are
unaffected).

### Files

| File                                      | Change                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------- |
| `app/_lib/virtualLists.ts` (new)          | `STARRED_LIST_ID`, `isVirtualListId()`                                                |
| `app/_lib/actions.ts`                     | `getStarredTasks()` (+ optional `countStarredTasks()`)                                |
| `app/starred/page.tsx` (new)              | desktop route: sidebar + virtual TasksPane + detail pane                              |
| `app/[listId]/TasksPane.tsx`              | `virtualList` prop: header/menu/add-row/sort gating                                   |
| `app/_components/TaskItem.tsx`            | `showListBadge` + `detailBasePath` props                                              |
| `app/ListSidebar.tsx` + `.module.css`     | pinned Starred row above the sortable list                                            |
| `app/_components/MobileTasksCarousel.tsx` | synthetic slide at index 1; `loadList` fork on the pseudo-id                          |
| `SPEC.md`, `roadmap.md`, `CLAUDE.md`      | TSK-28 requirement + UI-rules note ("Starred is virtual — never a `tasks_lists` row") |
| `package.json`                            | feat → minor bump                                                                     |

Unit tests: `getStarredTasks` scoping (tenant/owner, favorite-only, list
decoration) alongside existing action tests; `isVirtualListId` trivially.

### Verification

1. `pnpm dev`: star tasks in two different lists → Starred row appears first
   in the sidebar with the right count; opening it shows both tasks with
   source-list badges, sorted by due date.
2. In the starred view: complete a task (row moves to COMPLETED section),
   un-star one (disappears on refresh), open detail via row (URL is
   `/tasks/starred?task=…`, close returns to `/tasks/starred`), move a task to
   another list from the detail pane (stays starred, badge updates), bulk
   select + move/delete.
3. Confirm absent affordances: no add-task row, no drag handles, no
   rename/colour/delete in the ⋯ menu, Sort by has no Manual option.
4. Mobile viewport: swipe right from the first list → Starred slide (between
   Lists index and first list); cache/prefetch works (no spinner on
   revisit); bare `/tasks` still lands on the first real list; swipe-to-reveal
   and carousel navigation unaffected on starred rows.
5. Regression: real lists unchanged (reorder, rename, delete, add); deep link
   `/tasks/starred` works logged-in; unknown slugs other than `starred` still 404.
6. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`; version
   bump; draft PR.

---

## Task 4 — Per-plugin push notification icon

**Status:** shipped ✅ — platform fix on `fix/per-plugin-push-icon`
(`sovereignfs/sovereign`); this repo's own stale `icon: 'calendar'` follow-up
removed on `fix/remove-stale-push-icon`.
**Repo:** platform monorepo (`sovereignfs/sovereign`) — this is runtime/SDK
shell chrome, not a tasks-plugin change. Surfaced by a tasks-plugin push
notification (due-reminder) showing the platform's generic icon instead of
the Tasks app icon. Branch type: `fix/` (patch bumps).

### Problem

Web Push notifications from every plugin show the platform's generic icon
(`/icons/icon-192x192.png`) instead of the sending plugin's own icon.

### Root cause (verified)

A semantic mismatch in the SDK, not a missing feature:

- `SendNotificationInput.icon` ([packages/sdk/src/types.ts:133](../../../packages/sdk/src/types.ts))
  is documented as _"an `<Icon>` name from `@sovereignfs/ui`"_ — an SVG
  component name (e.g. `'calendar'`), intended for in-app rendering.
- **Nothing in-app actually reads it.** `NotificationBell.tsx`'s `CategoryIcon`
  switches on `category`, not `icon`; `Toast.tsx` does the same. The field is
  effectively vestigial for its documented purpose.
- The only real consumer is `runtime/worker/index.ts:26` —
  `self.registration.showNotification(data.title, { icon: data.icon ?? '/icons/icon-192x192.png', ... })`.
  The Push API's `icon` option is a **URL to an image**, not a component name.
  `sovereign-tasks`'s due-reminder handler passes `icon: 'calendar'`
  ([app/_jobs/due-reminders.ts:100,156](../app/_jobs/due-reminders.ts)) — the
  browser tries to fetch `'calendar'` as an image, fails, and silently falls
  back to the platform default. This is why the tasks push notification showed
  the "S" platform icon instead of the Tasks icon.

### What already exists (no new infra needed)

- Every installed plugin's icon is already served statically and stably at
  **`/plugin-icons/<pluginId>.svg`** — copied by `copyPluginIcons()` in
  `scripts/generate-registry.ts` (~line 443), the same source the launcher
  tiles use. No session gate.
- `sendNotification`'s fan-out already carries `source` (the sending plugin's
  id) all the way through to `fanOutPushToUser`
  (`runtime/src/sdk-host.ts` → `runtime/src/push.ts`), so a per-plugin default
  can be computed without any new data being threaded through.

### Platform constraint (does not block the fix, but sets expectations)

**iOS Safari ignores custom push-notification icons entirely.** Apple's Web
Push implementation always shows the installed PWA's own home-screen icon,
by design — there is no override, before or after this fix. Chrome and
Firefox (desktop + Android) _do_ respect a custom icon. This fix has real
value on those platforms; iOS will keep showing the platform icon for every
plugin's push notifications regardless. State this plainly in the PR
description so it isn't mistaken for an incomplete fix later.

### Design

1. **Fix the field's semantics.** Repurpose `SendNotificationInput.icon` (and
   `PushPayload.icon` in `runtime/src/push.ts` /
   `runtime/worker/index.ts`) to mean _"URL to an image, shown in the OS push
   notification"_ — update the doc comment accordingly. Since nothing in-app
   consumes it today, this is a safe redefinition, not a breaking change to
   any real caller (`sovereign-tasks` is currently the only plugin passing an
   `icon` value, and it's already effectively broken).
2. **Default to the plugin's own icon.** In `fanOutPushToUser`
   (`runtime/src/push.ts`), when a notification's `icon` is unset, default it
   to `/plugin-icons/<source>.svg` using the `source` (plugin id) already
   available at that point — no new plumbing. An explicit `icon` value passed
   by a plugin still wins (e.g. a plugin wanting to send a notification-specific
   image rather than its own logo).
3. **`sovereign-tasks`'s `icon: 'calendar'`** ([app/_jobs/due-reminders.ts](../app/_jobs/due-reminders.ts)):
   remove it — the new per-plugin default (the Tasks app icon) is more
   correct than an arbitrary SVG-name string ever was. (Small follow-up
   commit in the sovereign-tasks repo, once the platform fix ships.)
4. **SVG reliability check** (verify at implementation, not assumed): Chrome's
   Push API `icon` option generally rasterizes SVG correctly on modern
   versions, but this should be confirmed live rather than assumed — if
   inconsistent, generate a PNG alongside each plugin's `icon.svg` in
   `copyPluginIcons()` (a raster fallback) rather than degrading silently.

### Files

| File                                                             | Change                                                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/sdk/src/types.ts`                                      | `SendNotificationInput.icon` doc comment corrected (URL, not component name)                                                               |
| `runtime/src/push.ts`                                            | `PushPayload.icon` doc comment corrected; `fanOutPushToUser`/`fanOutPushToUsers` default `icon` to `/plugin-icons/<source>.svg` when unset |
| `runtime/worker/index.ts`                                        | no logic change expected (already passes `data.icon` through) — confirm during implementation                                              |
| `runtime/package.json` + root `package.json`                     | patch bumps (fix)                                                                                                                          |
| _(sovereign-tasks repo, follow-up)_ `app/_jobs/due-reminders.ts` | remove `icon: 'calendar'`                                                                                                                  |

### Verification

1. Unit test in `runtime/src/__tests__/push.test.ts`: notification with no
   `icon` → `sendNotification` called with a payload whose `icon` is
   `/plugin-icons/<source>.svg`; notification with an explicit `icon` →
   that value passed through unchanged.
2. `pnpm dev`, production build (push only runs in a built SW), trigger a
   tasks due-reminder or any `sdk.notifications.send()` call → inspect the
   real OS notification on **desktop Chrome/Firefox**: shows the Tasks app
   icon, not the platform icon.
3. Confirm on iOS (if available) that the platform icon still shows —
   expected per the Apple constraint above, not a regression to chase.
4. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`; version
   bumps; draft PR against the platform repo, with the iOS caveat stated in
   the description.

---

## Task 5 — JSON export/import (account-level data portability)

**Status:** shipped ✅ — implemented on `feat/tasks-data-portability`, assigned
requirement id **TSK-29**.
**Repo:** sovereign-tasks. Branch type: `feat/` (minor bump).

### Decisions made (no strong preference given; picked the lower-risk default)

1. **Wire into the existing account-level export/import flow (RFC 0007)**,
   not a standalone in-plugin "export as JSON" button. Every other plugin's
   data leaves/enters an instance this way (Account → Export my data → one
   ZIP with one `data.json` per plugin; Import restores from that ZIP); this
   plugin becomes a section in that flow the same way. Zero new UI needed in
   the Tasks plugin itself. A standalone tasks-only button is a plausible
   future add-on, not built here.
2. **Include a deletion handler (RFC 0033)** alongside export/import — once a
   plugin is wired into the portability system at all, leaving account
   deletion unhandled means tasks data survives as an orphaned row
   (`ownerId` pointing at a deleted user). Low incremental cost: reuses the
   existing `deleteList()` cascade logic (see below).

### Problem

There is currently no way to get tasks data out of (or back into) an
instance — no backup, no instance-to-instance move, no participation in
account-level export/deletion.

### Current state (verified — the platform side needs zero changes)

- **SDK contract** (`packages/sdk/src/portability.ts`): `ExportContext { userId, tenantId }`;
  `ImportContext { userId, tenantId, remapId(originalId): string }` — a
  stable per-import id remapper; `PluginExportSection { pluginId, schemaVersion, data, blobs? }`
  is the required return envelope (`data` itself is plugin-defined JSON);
  `sdk.portability.provideExport(resolver)` / `provideImport(handler)` /
  `provideDelete(handler)` register the plugin's functions — must be called
  from request-scoped plugin code (reads `x-sovereign-plugin-id` from
  headers), so registration happens once from `app/layout.tsx`, same as every
  other request-scoped setup.
- **Reference implementation to mirror**: `plugins/sovereign-plainwrite.local/app/_lib/portability.ts`,
  registered from that plugin's `layout.tsx`. Pattern: direct Drizzle queries
  scoped by `tenantId`+ownership (not the UI-shaped action functions, which
  add derived fields); a type-guard validating the imported shape before
  touching the DB; **additive import — never wipes existing data**; id
  collisions handled via `ctx.remapId()` + a local id map translating every
  cross-reference; secrets/credentials excluded from export (metadata only)
  and never restored on import. Its `__tests__/portability.test.ts` is the
  test-pattern reference: mocks `@sovereignfs/sdk` to capture the registered
  functions, mocks `drizzle-orm`'s `eq`/`and` into an interpretable condition
  tree against an in-memory fake table-keyed db — runs real insert/select/
  delete logic with no real database.
- **Runtime orchestration** (`runtime/src/portability/`): `registry.ts` is
  the in-process registration store; `platform.ts`'s `eligiblePluginIds(permission)`
  gates participation on the plugin being installed, enabled, and declaring
  `data:export`/`data:import` in its manifest; `bundle.ts` defines the ZIP
  layout (`plugins/<pluginId>/data.json` + optional `blobs/`) and per-section
  checksums; `assemble.ts`/`restore.ts` drive the actual export/import walk —
  **none of this needs to change**, it already generically supports any
  plugin that registers.
- **API routes** (already generic, no change needed): `GET /api/account/export/route.ts`
  streams the ZIP; `POST /api/account/import/route.ts` accepts a multipart
  `bundle` file (50 MB cap) and returns an `ImportSummary`.
- **Manifest gap**: `manifest.json` permissions are currently
  `["auth:session", "db:readWrite", "notifications:send"]` — missing
  `data:export` and `data:import` (RFC 0007; distinct from `data:provide`/
  `data:consume`, which is RFC 0002 cross-plugin sharing, not this).
- **Schema to serialize** (`app/_db/schema.ts`, all tables carry `tenantId`):
  `tasksLists` (id, ownerId, title, color, sortOrder, timestamps),
  `tasksUserListPrefs` (composite PK tenantId+userId+listId; showCompleted,
  defaultViewId), `tasksViews` (id, listId, ownerId, name, kind, config JSON
  string, isDefault, sortOrder), `tasksItems` (id, listId, parentId,
  assigneeId, title, notes, favorite, dueDate, dueTime, reminderSentAt,
  completedAt, sortOrder, recurrenceRule, seriesId), and
  `tasksNotificationPrefs` (composite PK tenantId+userId; enabled,
  morningTime, timezone, lastDigestDate) — user settings data, include it.
- **Existing cascade logic to reuse for the deletion handler**:
  `deleteList()` in `app/_lib/actions.ts` (~line 149) already does the
  ownership-verified app-layer cascade (SQLite has no enforced FK here) —
  deletes `tasksItems` → `tasksUserListPrefs` → `tasksViews` → `tasksLists`
  for one list. The deletion handler is "run that per owned list, plus
  delete the user's own `tasksNotificationPrefs` row."

### Design

**`app/_lib/portability.ts`** (new), registered from `app/layout.tsx`:

- **Export** (`exportTasksData`): direct-query all lists where
  `ownerId = ctx.userId AND tenantId = ctx.tenantId`; then items/views/prefs
  scoped to those list ids; plus the user's own `tasksUserListPrefs` and
  `tasksNotificationPrefs` rows. Return
  `{ pluginId: 'fs.sovereign.tasks', schemaVersion: 1, data: {...} }` — no
  `blobs` (tasks has no file attachments).
- **Import** (`importTasksData`): validate incoming shape with a type guard
  (reject unrecognized `schemaVersion` or structure, mirroring plainwrite's
  `isPlainwriteExportData`); **additive only** — no wipe. Remap every
  plugin-owned id via `ctx.remapId()`: `tasksLists.id`, `tasksViews.id`,
  `tasksItems.id` (and its self-referencing `parentId` for subtasks), and
  `seriesId` (recurrence grouping — remap consistently so an imported
  recurring series stays linked to itself, even though it's not a literal FK
  to another table). Rewrite every cross-reference through a local id map
  built during the pass (list→view/item, item→parent, prefs→list/view) the
  same way plainwrite's `projectIdMap` does, skipping rows whose referenced
  id isn't in the map instead of hard-failing. `assigneeId` passes through
  unchanged (nullable, unused — collaboration/TSK-10-14 is still blocked on
  `sdk.directory`, so this field is always null in practice today; revisit
  when that ships).
- **Delete** (`deleteAllTasksData`): for each list owned by the user, run the
  same steps `deleteList()` already does; separately delete the user's
  `tasksNotificationPrefs` row (not list-scoped). Return
  `{ deleted: <total rows>, errors: [] }`.

### Files

| File                                           | Change                                                                                                                                                                                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/_lib/portability.ts` (new)                | `exportTasksData`, `importTasksData`, `deleteAllTasksData`, `registerPortabilityHandlers()`                                                                                                                                                           |
| `app/layout.tsx`                               | call `registerPortabilityHandlers()` (best-effort, matching plainwrite's `layout.tsx` wrapping)                                                                                                                                                       |
| `app/_lib/__tests__/portability.test.ts` (new) | same fake-db/drizzle-mock harness as plainwrite's test; cover: export shape + tenant/owner scoping, import shape rejection, remap + cross-reference rebuild (list/view/item/parentId/seriesId), orphan-reference skip behavior, delete cascade totals |
| `manifest.json`                                | add `data:export`, `data:import` permissions                                                                                                                                                                                                          |
| `CLAUDE.md`, `SPEC.md`, `roadmap.md`           | note portability participation (proposed TSK-29)                                                                                                                                                                                                      |
| `package.json`                                 | feat → minor bump                                                                                                                                                                                                                                     |

### Verification

1. `pnpm dev`, log in, create lists/tasks/subtasks/a recurring series/starred
   items, set tasks notification prefs. Account → Export my data → download
   the ZIP, confirm `plugins/fs.sovereign.tasks/data.json` is present and
   contains everything.
2. Delete all tasks data locally (or use a second test account), Account →
   Import my data → upload the same ZIP → confirm lists/tasks/subtasks/
   recurring series/stars/prefs are all restored, with new ids (not
   colliding with anything pre-existing) and correct cross-references (a
   subtask still points at its parent, a recurring task's series is still
   linked, `tasksUserListPrefs.defaultViewId` still resolves).
3. Re-import the same ZIP a second time without deleting anything first →
   confirm it's additive (existing data untouched, a second copy of
   everything appears with fresh remapped ids) — matches the documented
   "additive, no wipe" contract.
4. Trigger account deletion (or call the deletion handler directly in a
   test) → confirm all of the user's lists/items/views/prefs are gone.
5. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`; version
   bump; draft PR.

---

## Task 6 — Sticky list header + add-task row while scrolling

**Status:** shipped ✅ — implemented on `feat/sticky-list-header` (judged
`feat/`, minor bump — user-visible behavior change on every breakpoint).
**Repo:** sovereign-tasks. Branch type: `feat/`(minor bump — user-visible
behavior change) or `fix/` if judged a pure polish item at implementation
time.

A real bug turned up during live verification that this plan didn't
anticipate: on mobile, `.stickyHeader`'s `z-index: 1` tied with
`TaskItem.module.css`'s own mobile-only `.row { z-index: 1; }` (its swipe-
to-reveal stacking need) — with no intervening ancestor establishing its own
stacking context between a task row and `.pane`, the tie resolved by DOM
order, and `.taskList` (rendered after the sticky header) painted over it.
Task rows scrolled straight through the "pinned" header instead of stopping
underneath it. Fixed by bumping the sticky header to `z-index: 2` — confirmed
via `elementFromPoint` hit-testing at multiple y-coordinates (not just a
screenshot, which didn't reliably reflect the live paint order in this
environment) before and after the fix.

### Problem

On the task-list pane, the list title/⋯-menu header and the "Add a task…"
input scroll away with the rest of the list. On a long list, both the list's
identity (which list am I looking at) and the primary "add a task" action
require scrolling back to the top to reach.

### Current state (verified)

- `.pane` (`app/[listId]/TasksPane.module.css`) is `overflow-y: auto` — the
  scroll container. `.header` (title row + menu) and `.addRow` (the add-task
  input) are plain flex children at the top of it, with no sticky
  positioning — everything scrolls together as one block. Both have their own
  `border-bottom` already.
- **A directly relevant precedent + a lesson already learned in this exact
  plugin**: `TaskDetailPane`'s `.top` uses `position: sticky; top: 0` for
  the same reason, and it broke once because `background-color: inherit`
  silently resolved to transparent — an intermediate wrapper (`Sheet`'s
  `.content`) never set its own `background-color`, so scrolled content
  showed through the "sticky" header on mobile. Fixed via a
  `--tasks-detail-bg` custom property (cascades through any depth of
  nesting) instead of `inherit`. **Reuse that exact technique here** — do not
  reintroduce `inherit`.
- `TasksPane` is used for both real lists (`app/[listId]/page.tsx`,
  `MobileTasksCarousel.tsx`) and — once Task 3 (virtual "Starred" list) ships
  — the virtual list. Since Task 3 reuses `TasksPane` itself (not a fork),
  this sticky-header change automatically covers the Starred view too with no
  extra work, as long as the CSS isn't scoped to anything list-specific.
- The header's `⋯` button (`.menuBtn`) opens `@sovereignfs/ui`'s `Menu`
  (`TasksPane.tsx:511`), which forks Popover(desktop)/Drawer(mobile)
  internally. Popover positioning is normally computed from the trigger's
  live bounding rect at open time, so a sticky trigger should be unaffected —
  **verify this live, don't assume** (noted as a regression check below).

### Design

- Wrap `.header` and `.addRow` in a shared sticky container (or make both
  independently `position: sticky; top: 0`, stacked — `.header` needs
  `top: 0` and `.addRow` needs `top: <.header's rendered height>` if kept as
  two separate sticky elements; simpler to wrap both in one
  `.stickyHeader` block with a single `position: sticky; top: 0` so there's
  only one offset to maintain).
- Opaque background via a custom property (matching `TaskDetailPane`'s
  `--tasks-detail-bg` pattern) — `.pane`'s own background already differs by
  context (desktop three-column vs. mobile carousel slide), so this needs
  the same non-`inherit` approach, not a copy-paste of a hardcoded color.
- Keep the existing `border-bottom` on `.addRow` (or move it to the sticky
  wrapper's bottom edge) as the visual separator between pinned chrome and
  scrolling content — same purpose `TaskDetailPane`'s sticky header border
  already serves.
- No change to the filter-folds-into-menu measurement logic
  (`TasksPane.tsx`'s hidden shadow-row technique) — sticky positioning
  doesn't affect layout measurement, just paint; call out as a regression
  check rather than assuming zero interaction.
- Desktop: apply the same sticky treatment for consistency (no
  mobile-only gate) — in the three-column layout the effect is subtler
  (the column is usually tall enough that the header rarely scrolls out
  of view already) but there's no reason to special-case it away.

### Files

| File                                                         | Change                                                                                                                                          |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/[listId]/TasksPane.module.css`                          | `.header`/`.addRow` → sticky wrapper; opaque background custom property (mirroring `TaskDetailPane.module.css`'s `--tasks-detail-bg`)           |
| `app/[listId]/TasksPane.tsx`                                 | wrap `.header`/`.addRow` JSX in the new sticky container if a wrapper element is needed                                                         |
| `app/[listId]/page.module.css` (desktop three-column layout) | supply the sticky header's background override the same way `.detailCol` does for `TaskDetailPane`, if the token needs a desktop-specific value |

### Verification

1. `pnpm dev`, mobile viewport, a list with enough tasks to scroll: confirm
   the title/menu row and the add-task input stay pinned at the top while
   the task rows scroll underneath, with no scrolled content visible through
   either (the exact bug class fixed for `TaskDetailPane` — check carefully).
2. Tap the `⋯` menu while scrolled — confirm it opens anchored to the
   (still-visible, pinned) trigger correctly on both mobile (Drawer) and
   desktop (Popover).
3. Confirm the add-task input still works normally while scrolled (type,
   press Enter, new task appears in the (still-scrolled) list below).
4. Repeat on desktop three-column layout — no visual regression to the
   column's existing look when the list is short enough not to scroll.
5. Once Task 3 ships: confirm the virtual Starred list's header (star icon +
   "Starred" title, no add-row per that task's spec) also sticks correctly
   with no extra code — it inherits this from shared `TasksPane` usage.
6. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`; version
   bump; draft PR.

---

## Task 7 — De-dupe `loadList` to stop duplicate server-action bursts on mobile

**Status:** shipped ✅ — implemented on `fix/dedupe-loadlist`.
**Repo:** sovereign-tasks. Branch type: `fix/` (patch bump).

### Problem

Live-testing the mobile carousel (browser network tab) showed ~10 near-identical
`POST` requests fire to the same list route on a single page load, with no user
interaction.

### Root cause (verified)

`MobileTasksCarousel.tsx`'s prefetch effect (mount, `~245-254`) calls
`loadList(listId)` for the active slide and its two neighbors — landing on a
real list fires `getTasks` + `getOrCreatePrefs` per slide, plus `getStarredTasks`
for the Starred neighbor: 5 real requests, not a bug by itself. `loadList`
(`171-216`) had **no de-dupe/in-flight guard** — its only guard
(`if (!listState[id]) loadList(id)`, in the effect) reads `listState` from that
effect instance's own stale render closure. Next dev's React Strict Mode
double-invokes the mount effect; both invocations share the same stale empty
`listState`, so the guard doesn't stop the second pass — 5 × 2 ≈ 10 near-identical
requests, matching what was observed. Confirmed as a one-time double-burst per
mount in dev, not an unbounded loop, but the missing guard would also double-fire
on a real fast-swipe-past-a-neighbor-then-back case.

### Fix (implemented)

Added `loadingIdsRef` (`useRef<Set<string>>`) to `MobileTasksCarousel.tsx`.
`loadList` checks it synchronously on entry and no-ops if the id is already
in flight; adds the id before the fetch, removes it in a `finally` regardless
of success/failure. This guards every caller (the mount-prefetch effect above,
and the `refreshSignal` re-fetch effect) against overlapping calls for the
same list, without changing when a _settled_ list is allowed to refetch.

### Files

| File                                      | Change                                                        |
| ----------------------------------------- | ------------------------------------------------------------- |
| `app/_components/MobileTasksCarousel.tsx` | `loadingIdsRef`; `loadList` guarded entry + `finally` cleanup |

### Verification

1. `pnpm dev`, mobile viewport, open the Network tab, navigate to `/tasks`:
   confirm the request count per list lands at the real number (≤5 for a
   fresh 3-slide window), not ~10. **Confirmed live** — dropped from ~10 to 7
   (the residual 7, one of which is a superseded/aborted request, matches the
   two-phase cold-load URL sync at bare `/tasks`, not true duplicates).
2. Swipe rapidly past a neighbor list and back before it would have settled;
   confirm no duplicate fetch pair fires for it.
3. Regression: switching lists still shows fresh data with no stale cache;
   toggling a task still triggers the `refreshSignal` refetch normally (the
   guard must not block a _later_, non-overlapping refetch).
4. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`; version
   bump; draft PR.

---

## Task 8 — Fix `sdk.db.getClient()` returning the platform DB from schedule handlers

**Status:** shipped ✅ — platform draft PR
[sovereignfs/sovereign#482](https://github.com/sovereignfs/sovereign/pull/482).
**Repo:** platform monorepo (`sovereignfs/sovereign`) only — **no change needed
in this plugin**, see below. Documented here because this plugin's own
`due-reminders` schedule surfaced it. Branch type: `fix/` (patch bump).

### Problem

`runtime` server logs showed, every minute since server start:

```
scheduler: schedule handler failed pluginId=fs.sovereign.tasks scheduleId=due-reminders
Failed query: select ... from "tasks_notification_prefs" where "enabled" = ?
```

### Root cause (verified against the live dev DB, not assumed)

Queried the running sqld instance directly (`docker exec` into
`sovereign-sqld-dev`, found the real per-plugin namespace at
`/var/lib/sqld/iku.db/dbs/plugin_fs_sovereign_tasks`, then hit it via
`Host: plugin_fs_sovereign_tasks.local` against the HTTP pipeline endpoint):
`tasks_notification_prefs` exists and the exact failing SQL runs fine against
it. The platform's **default** namespace (queried the same way with no `Host`
override) has no `tasks_*` tables at all — confirming the scheduler's query
was running against the **wrong database**, not a broken query.

`packages/sdk/src/db.ts`'s `getClient()` resolves the calling plugin's id by
reading `x-sovereign-plugin-id` via `next/headers`' `headers()` — which only
resolves inside a real Next.js request. `runtime/src/scheduler.ts` (and
`jobs.ts`) invoke plugin handlers outside any request (a plain interval/worker
loop), so `pluginId` always resolved to `null`, and `getClient(null)` is a
**valid, meaningful** call (it's what `type: "platform"` plugins use
deliberately) — so the failure was silent until the query hit a missing table,
not an obvious auth-style error.

### Fix (shipped, platform repo — this plugin's own code is untouched)

**First attempt was wrong and reverted before it ever left the branch**: giving
`sdk.db.getClient()` an optional `requestHeaders` override parameter, mirroring
`sdk.email.sendToUser()`'s existing pattern. It compiled and worked, but the
platform's own pre-push hook caught
`runtime/src/__tests__/sdk-host-db-routing.test.ts` asserting
`sdk.db.getClient.length === 0` as a **deliberate security invariant** — this
call must have zero argument surface, so no plugin-authored code can ever
supply an identity to claim a different plugin's database. Full read/write
access to another plugin's entire isolated database is a materially
higher-severity concern than the email-spoofing risk `sdk.email`'s own
explicit-headers parameter already accepts, which is presumably why the two
surfaces were deliberately held to different standards.

The actual fix mirrors `portability/plugin-context.ts`'s existing solution to
the identical problem (export/import resolvers, also invoked outside any
plugin request): a new `runtime/src/background-plugin-context.ts`
`AsyncLocalStorage`, populated only by trusted runtime code
(`scheduler.ts`/`jobs.ts` wrap each handler invocation in
`runWithBackgroundPlugin(pluginId, ...)`), checked by `sdk-host.ts`'s
`db.getClient()` as a fallback after the request header and the portability
context. **`sdk.db.getClient()`'s public signature and zero-argument
invariant are completely untouched** — this plugin's `due-reminders.ts` still
calls plain `sdk.db.getClient()`, exactly as before, and is now simply correct
with no code change at all.

### Files (platform repo — none in this plugin)

| File                                                                                                                                | Change                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `runtime/src/background-plugin-context.ts` (new)                                                                                    | `AsyncLocalStorage` context, mirrors `portability/plugin-context.ts` |
| `runtime/src/sdk-host.ts`                                                                                                           | `db.getClient()` fallback chain checks the new context               |
| `runtime/src/scheduler.ts`                                                                                                          | wraps handler invocation in `runWithBackgroundPlugin`                |
| `runtime/src/jobs.ts`                                                                                                               | wraps handler invocation in `runWithBackgroundPlugin`                |
| `runtime/src/__tests__/background-plugin-context.test.ts` (new), `scheduler.test.ts`, `jobs.test.ts`, `sdk-host-db-routing.test.ts` | regression coverage                                                  |

### Verification

1. `pnpm exec vitest run` (platform root, full suite) — 2245 passed.
   **Confirmed live.**
2. `pnpm dev`, wait for the next scheduler tick (≤60s): confirm the
   `scheduler: schedule handler failed` log line for `due-reminders` no longer
   appears. **Confirmed live** — restarted the dev server (schedule handlers
   are imported once at startup, no HMR), waited through multiple ticks: zero
   `failed`/error log lines, versus one every single minute before the fix.
3. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm design:tokens:check && pnpm test`
   (platform root, via the pre-push hook) — green; patch bump (root
   `package.json`); draft PR against the platform repo.

---

## Task 9 — Fix add-task appearing to do nothing on mobile

**Status:** shipped ✅ — implemented on `fix/mobile-add-task-feedback`.
**Repo:** sovereign-tasks. Branch type: `fix/` (patch bump).

### Problem

Live-testing on mobile: typing a task and pressing Enter appeared to do
nothing — the input didn't clear, the task count didn't update, and the new
row wasn't visible until some unrelated navigation happened to re-render the
list. The task _was_ actually being created (confirmed by finding it in a
later, unrelated re-render).

### Root cause (verified — not a missing optimistic update)

`TasksPane.tsx`'s `handleAddTask` already had a working optimistic path
(`setNewTitle('')` synchronously, `applyTaskAction({ type: 'add', ... })` via
`useOptimistic`) — the same mechanism `toggleComplete`/star already use
successfully. The actual bug is specific to how the mobile carousel is wired:
`useOptimistic`'s overlay is discarded the moment its enclosing transition
settles, reverting to whatever `initialTasks` prop is current at that point.
On desktop, `router.refresh()` re-runs `page.tsx` synchronously with the
transition, so fresh `initialTasks` (including the new task) is ready by the
time the overlay is discarded. On mobile, `MobileTasksCarousel` deliberately
keeps its own decoupled task cache (`listState`) — `router.refresh()` only
changes `refreshSignal`'s identity, which triggers `loadList`'s own _separate,
asynchronous_ refetch. The transition wrapping `createTask()` +
`router.refresh()` settles (discarding the optimistic overlay) before that
refetch resolves and delivers a fresh `initialTasks` containing the new task —
a real gap where neither the optimistic value nor the authoritative one
includes it yet. This is the exact class of bug `onTaskFieldPatch` (toggle/
star) was already built to prevent — it just wasn't extended to the add path.

### Fix (implemented)

New optional `onTaskAdded?: (task: TaskRow) => void` prop on `TasksPane`,
called synchronously alongside `applyTaskAction` in `handleAddTask` (desktop's
`page.tsx` doesn't pass it, same as `onTaskFieldPatch`). `MobileTasksCarousel`
gets a new `addTask(listId, task)` callback (mirrors `patchTask`) that appends
the task straight into `listState[listId].tasks`, and passes it as
`onTaskAdded` to the real-list `TasksPane` instance (the Starred slide has no
add-row, so it never needs this).

### Files

| File                                      | Change                                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/[listId]/TasksPane.tsx`              | `onTaskAdded` prop; call it in `handleAddTask`; hoisted the optimistic task object to a local so both the reducer dispatch and the new callback share it |
| `app/_components/MobileTasksCarousel.tsx` | `addTask` callback; wired as `onTaskAdded` on the real-list slide                                                                                        |

### Verification

1. `pnpm dev`, mobile viewport, add a task: input clears immediately, task
   count updates immediately, the row is visible immediately — no flash of
   "nothing happened." **Confirmed live** — count went 16 → 17 instantly, the
   new row appeared at the top with no reload, and the row was independently
   confirmed as a real (non-optimistic-id) DB row afterward.
2. Swipe away to a neighbor list and back: the added task is still there
   (survived the carousel's mount-window unmount/remount, since it's now in
   the persistent `listState` cache, not just the discarded optimistic
   overlay).
3. Regression: desktop add-task unaffected (no `onTaskAdded` passed there);
   Starred view still has no add-row.
4. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm test`; version
   bump; draft PR.

---

## Task 10 — Investigate task-detail click race (wrong/no detail opens)

**Status:** closed — not an app bug. Root-caused to the browser-automation
tooling used for testing, not `sovereign-tasks`.
**Repo:** sovereign-tasks (investigation only — no code change).

### Problem

Reproduced twice during earlier live testing, in different shapes: once as
"click a task row → a _different_ task's detail opens," once as "click a
task row → nothing opens at all." Re-tested after Task 7 shipped, per that
task's own note, using a clean single-click repro with no other requests in
flight — **still reproduced both shapes**, ruling out Task 7's duplicate-burst
bug as the cause.

### Root cause (found via direct event instrumentation, not the app)

Attached capture-phase listeners for `pointerdown`/`mousedown`/`pointerup`/
`mouseup`/`click` directly on `document` and drove the same click two ways:

- The test tool's `ref`-based click (resolves a target from a previously
  captured accessibility-tree snapshot): **zero events fired anywhere in the
  document** — not suppressed, not `defaultPrevented`, simply never
  dispatched. Consistent with a stale/invalid backend element reference
  after the tree had shifted since the snapshot was taken, not anything
  `sovereign-tasks`' own code could see or guard against.
- The same click as a real event sequence at **raw screen coordinates**
  (bypassing the tool's ref-resolution step entirely): all five events fired
  cleanly, `defaultPrevented: false` throughout, correct navigation to the
  correct task's `?task=<id>` every time — independently confirmed against
  the live database (`tasks_items` row `86792e1a…` → title `"dasd"`) matching
  exactly what rendered in the detail pane.

No dnd-kit interference, no `TasksPane`/`MobileTasksCarousel` state issue,
no index-vs-id mismatch — every failure traced to the click never reaching
the DOM at all via one specific tool invocation shape, and every success
confirmed correct app behavior end to end when the click was real. An
earlier "wrong task opened" observation was very likely the same
ref-resolution issue compounded by a screenshot-pixel-vs-CSS-pixel
coordinate mismatch when manually estimating click coordinates from a
screenshot — a mistake made during that earlier investigation, not a defect
in this plugin.

### Why this doesn't need a plugin-side fix

`TasksPane.tsx` keys every row by `task.id` (not array index), and
`TaskItem`'s detail `<Link>` href is built from that same task object — the
code path was never implicated by any of the above. Nothing in this
plugin's control can compensate for a testing tool failing to dispatch an
event in the first place.

---

## Task 11 — Tighten `SwipableMobileCarouselDots` spacing for many-list instances

**Status:** shipped ✅ — platform PR
[sovereignfs/sovereign#483](https://github.com/sovereignfs/sovereign/pull/483)
(the DS component change), plugin branch `feat/compact-carousel-dots` (the
adoption).
**Repo:** platform monorepo (`sovereignfs/sovereign`) for the DS component
change, sovereign-tasks for adopting it. `SwipableMobileCarouselDots` is a
shared Design System component (`packages/ui`), consumed by every plugin
using `SwipableMobileCarousel`. Per this repo's DS-first rule, the
spacing/density change lives there, not as a plugin-local override.

### Problem

What looked like a long row of "list-switcher tabs" during live testing is
`SwipableMobileCarouselDots`' default indicator — 20×20px hit targets,
`gap: var(--sv-space-2)` (0.5rem) between them. With ~12 lists (Lists index +
Starred + 10 real lists) that's roughly 328px of dots in a 375px viewport —
plausibly reads as cramped/lengthy on an instance with more than a handful of
lists.

### Why this was previously deferred, and what changed

Any change here affects every consumer of `SwipableMobileCarousel`
(currently Tasks and Shopper, per the DS docs) — `sovereign-shopper` isn't
installed in this dev checkout, so its actual visual tolerance for a spacing
change couldn't be verified directly. Rather than blindly changing the
shared default (which would have affected Shopper sight-unseen) or
continuing to defer, shipped as a genuinely opt-in **new prop** instead:
`density?: 'default' | 'compact'` on `SwipableMobileCarouselDots`, default
unchanged, so Shopper's spacing is provably untouched either way — no
consumer audit was actually required once the design avoided a shared-default
change.

### Fix (implemented)

Platform side (`packages/ui`): `density="compact"` halves the gap
(`--sv-space-2` → `--sv-space-1`); only the gap changes, each dot keeps its
own 20px hit target. New Storybook stories (`DotsManyDefault`/
`DotsManyCompact`) reproduce the real 12-dot scenario at both densities.
`docs/design-system.md` updated.

This plugin (`app/_components/MobileTasksCarousel.tsx`): supplies its own
`renderIndicator` forwarding the prop
(`renderIndicator={(props) => <SwipableMobileCarouselDots {...props} density="compact" />}`)
instead of leaving it `undefined` for the DS default — `SwipableMobileCarousel`'s
own `renderIndicator` callback signature doesn't carry `density` itself, so
opting in requires supplying the indicator explicitly, not a new pass-through
prop on the carousel.

### Files

| File                                                                                                          | Change                                                  |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/ui/src/components/SwipableMobileCarouselDots/SwipableMobileCarouselDots.tsx` (platform repo)        | `density` prop                                          |
| `packages/ui/src/components/SwipableMobileCarouselDots/SwipableMobileCarouselDots.module.css` (platform repo) | `.dotsCompact` rule                                     |
| `packages/ui/src/stories/SwipableMobileCarousel.stories.tsx` (platform repo)                                  | `DotsManyDefault`/`DotsManyCompact` stories             |
| `docs/design-system.md` (platform repo)                                                                       | `density` prop documented                               |
| `app/_components/MobileTasksCarousel.tsx`                                                                     | custom `renderIndicator` forwarding `density="compact"` |

### Verification

1. `pnpm --filter @sovereignfs/ui typecheck` (platform) — clean.
2. `pnpm exec tsc --noEmit` (this plugin's own `tsconfig.json`) — clean.
3. `pnpm format:check && pnpm lint && pnpm typecheck && pnpm design:tokens:check && pnpm test`
   (platform root, via the pre-push hook) — green; full suite (2245 passed).
4. Live-verified end-to-end: confirmed via the live DOM that the
   `dotsCompact` class applies on the running instance and the computed
   `gap` drops from 8px to 4px, with all 14 dots (Lists + Starred + 12 real
   lists in the test data) still rendering correctly.

## Task 12 — Fix invisible carousel dots; investigate swipe instability + header load

**Status:** partially shipped. The indicator-positioning bug is fixed and
merged (platform). The swipe-instability root cause is identified but not
fixed — it requires a product decision, not a mechanical patch (see below).
The header-loading report was investigated and not reproduced.

### Problem

Live user report against a real dev server (`localhost:5010`, not the
sandboxed preview): "swiping still not stable, list header still not loading
before tasks." This follows Task 11 (carousel dots `density="compact"`).

### Investigation

Logged into the same running instance in both the in-app browser preview
(mobile viewport) and a real iPhone 17 iOS Simulator (Safari), since prior
sessions found browser-automation `ref`-based clicks and synthetic gestures
can be unreliable proxies for real touch — see Task 10's write-up.

**Finding 1 — carousel dots were completely invisible (not just cramped).**
`getBoundingClientRect()`/`getComputedStyle()` on the live DOM showed the
dots' `role="tablist"` element at `position: static`, sitting directly below
`SwipableMobileCarousel`'s full-height `.scroller` box — clipped out of the
visible carousel area entirely, not just tightly spaced. Root cause: platform
repo, `packages/ui/src/components/SwipableMobileCarousel/SwipableMobileCarousel.tsx`
applied its overlay-positioning CSS class (`position: absolute; bottom:
var(--sv-space-3)`) directly to the _default_ `SwipableMobileCarouselDots`
instance, not to a wrapper around whatever `renderIndicator` returns. Task
11's own change necessarily switched this plugin to a _custom_
`renderIndicator` (to forward `density="compact"`, since the carousel's
`renderIndicator` callback signature has no `density` passthrough) — so the
positioning class silently stopped applying the moment `density="compact"`
shipped. This bug shipped in Task 11 and went unnoticed because that task's
own live verification checked the `dotsCompact` class and computed `gap`,
not the dots' on-screen position.

**Fixed in the platform repo** (`fix/carousel-custom-indicator-positioning`,
`packages/ui` `0.56.0` → `0.56.1`): `SwipableMobileCarousel.tsx` now always
wraps the resolved indicator (default or custom) in its own positioned slot
(`.dots` renamed `.indicatorSlot`), so positioning is owned by the carousel
regardless of which indicator implementation is used. Added a regression
test asserting both branches get the slot class. No change needed in this
plugin.

**Finding 2 — swipe instability root-caused, not yet fixed.** A real diagonal
touch gesture on the iPhone 17 simulator (`touch_path`, ~34px of vertical
drift over a ~340px horizontal drag — well within normal human swipe
imprecision) on a task row failed to navigate the carousel at all, and left
the row's drag handle visibly stuck in its `:hover`-revealed state
afterward (a separate, known iOS Safari "sticky hover after touch" quirk).
A perfectly horizontal swipe on the same row navigated cleanly every time.

Root cause: this plugin's whole-row long-press drag-reorder
(`app/_lib/dndSensors.ts`'s `useReorderSensors`, active whenever
`sortBy: 'manual'` — the default) and the platform carousel's horizontal
swipe both claim touch gestures starting anywhere on a task row. dnd-kit's
`TouchSensor` is _supposed_ to cancel cleanly and hand off to native
scrolling when movement exceeds its `tolerance` (8px) before the `delay`
(300ms) elapses — and its own activation-constraint logic does — but
`TouchSensor.setup()` (in `@dnd-kit/core`, not this codebase) registers a
non-passive `window`-level `touchmove` listener for the whole lifetime the
sensor is mounted, with an explicit comment: "force `event.preventDefault()`
calls to work in dynamically added touchmove event handlers... required for
iOS Safari." Once a touch gesture's first move event has to synchronously
round-trip through a non-passive listener, iOS Safari does not retroactively
resume native scroll-snap recognition for the rest of that same touch
sequence, even after the sensor cancels and detaches. This is a documented
dnd-kit/iOS Safari interaction, not a bug introduced by any change in this
plugin or the platform.

**Not fixed here** — a real fix means either narrowing touch drag-initiation
back to a dedicated handle (partially reverting the deliberate, documented
v0.12/v0.12.2 whole-row-touch-drag improvement — see this plugin's own
`CLAUDE.md` "Drag reorder" section) or picking a different gesture-
disambiguation strategy (e.g. suppressing whole-row touch drag specifically
while inside the mobile carousel, keeping it on desktop and any future
non-carousel touch surface). Both are product/UX trade-offs, not mechanical
patches, and this plugin's drag-reorder is a well-tested, deliberately-built
feature — not something to alter without sign-off.

**Finding 3 — header-loading complaint not reproduced.** Tested both a cold
full-page load (browser preview) and a multi-slide jump landing on a never-
before-loaded list (simulator, three rapid consecutive swipes) — in both
cases `MobileTasksCarousel.tsx`'s existing `SlideHeaderSkeleton` showed the
list title immediately, with no blank flash, matching its documented design
(`CLAUDE.md`'s `0.17.0` → `0.18.0` entry). No code change made. It's possible
what the user perceived as "header not loading" was actually a symptom of
Finding 2 — a swipe captured by drag-reorder leaves the carousel stuck on
the old slide, which could read as "the new header never loaded."

### Files

| File                                                                                                     | Change                                                  |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/ui/src/components/SwipableMobileCarousel/SwipableMobileCarousel.tsx` (platform repo)           | Always wrap the resolved indicator in a positioned slot |
| `packages/ui/src/components/SwipableMobileCarousel/SwipableMobileCarousel.module.css` (platform repo)    | `.dots` → `.indicatorSlot`                              |
| `packages/ui/src/components/SwipableMobileCarousel/__tests__/SwipableMobileCarousel.test.tsx` (platform) | Regression test for both indicator branches             |

No files changed in this plugin's repo for this task.

### Verification

1. Live DOM inspection (browser preview) before the fix: `position: static`,
   dots clipped below the scroller. After the fix: `position: absolute`,
   correctly overlaid ~12px above the carousel's bottom edge.
2. `pnpm vitest run SwipableMobileCarousel` (platform) — 15 passed (14
   pre-existing + 1 new regression test).
3. `pnpm typecheck`, `pnpm design:tokens:check` (platform) — clean.
4. Real touch-gesture testing on iPhone 17 Simulator / Safari: multiple
   clean horizontal swipes navigated correctly across several lists; a
   diagonal swipe on a manual-sort list's task row reproduced the
   swipe-capture bug described in Finding 2.

### Follow-up needed

Finding 2 (swipe-vs-drag-reorder gesture conflict) needs a developer decision
on which trade-off to take before it can be fixed. Raised directly rather
than filed as a silent TODO, since it affects a shipped, documented feature.

<!-- Add Task 13, … above this line as new numbered sections, and keep the
     index table at the top in sync. -->
