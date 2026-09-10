# Data-fetching architecture proposal & mobile interaction findings

A bundled audit of remaining mobile UX issues, each root-caused against the
current codebase, plus a proposed data-fetching/caching architecture revamp
that addresses a subset of them. Written so a fresh agent (human or AI) with
no other context can pick up any one item and act on it without needing the
investigation that produced this document repeated.

**How to use this doc:** each item below is planned here first, then
implemented — same convention as `docs/ux-improvement-plan.md`. One branch/PR
may cover several items when they share a fix. Update an item's **Status**
in place as work progresses; do not delete resolved items, mark them
`shipped` and leave the root-cause writeup for future reference. Statuses:
**planned** · **in progress** · **shipped** · **dropped**.

---

## Part 1 — Issue catalog

| #   | Issue                                                                       | Category                     | Data-fetching proposal addresses it? | Status                    |
| --- | --------------------------------------------------------------------------- | ---------------------------- | ------------------------------------ | ------------------------- |
| 1   | Subtask list refetches on every expand/collapse                             | Data fetching                | Yes — directly                       | shipped                   |
| 2   | Fast swiping through not-yet-visited lists shows a spinner per list         | Data fetching                | Yes — partially (prefetch scope)     | shipped                   |
| 3   | Checkbox/star tap has perceived latency despite existing optimistic updates | Rendering / gesture handling | No                                   | closed — not reproducible |
| 4   | Long-press-to-bulk-select competes with carousel swipe on mobile            | Gesture arbitration          | No                                   | shipped                   |
| 5   | iPad-sized viewports get the desktop layout, not the mobile one             | Breakpoint / config          | No                                   | shipped                   |
| 6   | Possible task-list reordering / count inconsistency                         | Correctness (unconfirmed)    | No                                   | likely not a bug          |
| 7   | Vertical overscroll on list scroll containers is not contained              | CSS / scroll containment     | No                                   | shipped                   |
| 8   | Every list's tasks are eagerly fetched on every page load, not just the active one — reported as mobile slowness | Data fetching | Yes — directly | shipped |
| 9   | Persisted (IndexedDB) cache never skips the network refetch, even when fresh | Data fetching | Yes — directly | shipped |
| 10  | Mobile briefly double-mounts two independent data-fetch instances (`DesktopTasksShell` + `MobileTasksCarousel`) on every cold load | Data fetching / SSR-hydration mismatch | Yes — directly | shipped |

---

### Issue 1 — Subtask list refetches on every expand/collapse cycle

**Category:** Data fetching / caching
**Status:** shipped

**Symptom:** Expanding a task's subtasks shows a loading delay every time,
including when that same task's subtasks were already fetched moments
earlier in the same session (e.g. collapse then immediately re-expand).

**Root cause:** `app/_components/TaskItem.tsx` conditionally mounts
`SubtaskList` only while expanded (`{expanded && <SubtaskList ... />}`,
around line 425). `app/_components/SubtaskList.tsx` keeps its own local
`useState<Subtask[]>([])` and fetches via `getSubtasks(parentId, listId)`
inside a `useEffect` that fires on every mount (lines 62–77). Because the
parent conditionally mounts/unmounts `SubtaskList` on every toggle, every
collapse discards all fetched state, and every re-expand — even of the
exact same task — repeats the full server round trip. There is no caching
layer between `SubtaskList` and the server action.

**Proposed fix:** Introduce a subtask cache keyed by parent task id, living
somewhere that survives `SubtaskList`'s own mount/unmount — e.g. lifted into
the per-list state already held by `TasksPane`/`MobileTasksCarousel`, or a
small dedicated cache module scoped to the active list's lifetime. On
expand, check the cache before calling `getSubtasks`; only fetch on a cache
miss or after an explicit invalidation (a subtask add/delete/toggle, or the
parent's own completion cascading to its subtasks — see
`SubtaskList.tsx`'s existing `parentCompletedAt`/`parentSubtaskCount`/
`parentSubtaskDoneCount` reload-trigger props, which already model exactly
this kind of invalidation and should inform the cache's own invalidation
rules).

**Relation to data-fetching proposal:** This is the narrowest, most
self-contained slice of Part 2's broader proposal. Recommended as the first
thing to implement — it has no open design questions blocking it (unlike
Issues 2's broader scope questions, see Part 2).

**Implementation notes:** Shipped as a module-level `Map<parentId, {
subtasks, signature }>` cache inside `SubtaskList.tsx` itself (not lifted
into `TasksPane`/`MobileTasksCarousel` as the original proposed fix's first
option suggested — the dedicated-cache-module option was simpler and
required no prop-plumbing changes to either of `SubtaskList`'s two call
sites, inline `TaskItem` and the detail pane). `signature` is derived from
exactly the same four props already used as reload triggers
(`listId`/`parentCompletedAt`/`parentSubtaskCount`/`parentSubtaskDoneCount`),
so every case that already forced a reload before this cache existed still
does; only a signature-preserving mount/unmount (a plain expand/collapse
toggle) now serves from cache instead of refetching. A local mutation
(toggle/add/delete) updates the cache alongside its own authoritative
reload, so a later remount reflects it without a second fetch. No automated
regression test — this plugin has no component-testing infrastructure
(`@testing-library/react` isn't a dependency anywhere in this repo; only
lib-level `.test.ts` files exist under `app/_lib/__tests__/`), and adding
that capability was judged a larger, separate change than this fix
warranted. Verified live instead: expand → collapse → re-expand produced
zero new network requests in the browser's own network log; toggling a
subtask then collapsing/re-expanding showed the updated state with no extra
fetch either.

---

### Issue 2 — Fast swiping through not-yet-visited lists shows a spinner per list

**Category:** Data fetching / caching
**Status:** shipped

**Symptom:** Swiping quickly through several lists that haven't been viewed
yet in the current session shows a loading spinner for each one in turn.

**Root cause:** `app/_components/MobileTasksCarousel.tsx` keeps a
client-side cache (`listState`, keyed by list id) that is never evicted
once populated — so this is **not** a caching-durability bug; a list
already in `listState` does not refetch on revisit. The spinner is
expected, by design, for a list not yet in that cache: the prefetch effect
(around line 310) only eagerly loads `[activeIndex - 1, activeIndex,
activeIndex + 1]` — the active slide plus its immediate neighbors — on
every `activeIndex` change. Swiping past more than one never-visited list
in a single continuous gesture, or swiping faster than the prefetch effect
and its subsequent fetch can resolve, surfaces the loading state for each
newly-active slide in turn.

**Proposed fix:** This is a genuine scope/tradeoff question, not a bug to
patch mechanically — options include: (a) widen the prefetch window beyond
±1 neighbor, (b) eagerly fetch every list's metadata (not full task bodies)
at carousel mount so the _header_ is always instant even when the body
isn't, which `SlideHeaderSkeleton` already partially achieves for title-only
data, or (c) fetch all lists' tasks up front at mount instead of lazily —
the most direct fit for the "fetch once at startup" framing in Part 2's
proposal, at the cost of a heavier initial load. Which of these is right
depends on the answers to Part 2's open design questions (particularly
staleness tolerance and how many lists a typical instance has).

**Relation to data-fetching proposal:** Directly in scope — this is the
first slice of Part 2's proposal to actually ship.

**Decision:** option (c)-leaning — background-warm every list's tasks
shortly after mount, not just ±1 neighbors, per Part 2's now-settled design
questions (plugin-local scope, revalidate-on-focus, IndexedDB persistence).

**Implementation notes:** New plugin-local module,
`app/_lib/listCache.ts`, holds the two pieces of the settled Part 2 design
that are about persistence/staleness rather than React state shape
(`MobileTasksCarousel.tsx`'s existing `listState` is still the in-memory
source of truth — this only adds a durable mirror and a couple of
timing-driven triggers around it):

- `readPersistedList`/`persistList` — a thin wrapper around
  `@sovereignfs/sdk/offline` (the SDK's existing IndexedDB-backed,
  plugin-scoped, encrypted-at-rest KV cache, RFC 0074), not a hand-rolled
  IndexedDB store. This was a deliberate choice, not the path of least
  resistance: `runtime/src/complete-sign-in.ts` calls `offline.clearAll()`
  on every successful new sign-in, which is the platform's only real
  "purge every cache on the logout/session boundary" guarantee — it covers
  a session ending by explicit sign-out, by expiring, or by the tab simply
  being closed, none of which a plugin-local "clear on the sign-out
  button's click handler" could catch on its own. Building a separate store
  here would have meant either losing that guarantee or re-deriving it —
  exactly the failure mode the platform's own `0.76.1` hotfix (see the
  platform repo's `CLAUDE.md`) already had a real incident over: a cache
  that lacked per-user partitioning and a logout-clear leaked a previous
  user's cached content to the next person on a shared device. No manifest
  change was needed to use it — `@sovereignfs/sdk/offline`'s own module has
  no gate requiring the `offline` manifest tier to be declared; that field
  only controls a separate platform behavior (service-worker-precaching the
  plugin's bare route for genuine no-network access), which this doesn't
  use. See `listCache.ts`'s own doc comment for the full reasoning.
- `STALE_AFTER_MS` (60 seconds) — the revalidate-on-focus threshold.

Wired into `MobileTasksCarousel.tsx`:

- **Cold-start hydration:** `loadList` now checks a `listStateRef` (a
  render-synced ref, not a `loadList` dependency, so its identity/deps stay
  unchanged — matching the file's existing `loadingIdsRef` stability
  convention) for an existing in-memory entry before fetching; if none
  exists (the common case right after a page reload, since the in-memory
  cache always starts empty), it tries the persisted cache first and seeds
  `listState` from it immediately if found, before the real network fetch
  — which still always runs and overwrites it once it resolves. This
  removes the loading skeleton for any list that was fetched in a _previous_
  session, not just previously this session.
- **Prefetch scope (the actual fix):** the mount/`activeIndex` effect still
  fetches `[activeIndex-1, activeIndex, activeIndex+1]` first (unchanged,
  keeps a single swipe instant), then loops over every other list and
  Starred and fires `loadList` for any not yet cached. A fast, continuous
  swipe past several never-visited lists in a row no longer outruns
  prefetching, since by the time it reaches list N, list N was very likely
  already warming in the background since mount. Heavier initial request
  burst than before (every list's tasks + prefs fetch fires roughly at
  once) — an accepted tradeoff given this plugin's realistic list counts (a
  personal task manager, not hundreds of lists); revisit if a real account
  with dozens-plus of lists reports this as a problem.
- **Revalidate-on-focus:** two triggers, both reusing `loadList`'s existing
  "keep showing already-loaded content, refresh quietly in the background"
  status handling (previously only exercised by the `refreshSignal` path) —
  (1) the active slide becoming active again (the same mount/`activeIndex`
  effect checks `Date.now() - entry.fetchedAt > STALE_AFTER_MS` for the
  newly-active list and refetches if stale), and (2) the tab/window
  regaining focus while an already-active slide has gone stale (a
  `visibilitychange`/`focus` listener registered once, reading current
  state through refs rather than depending on it directly, so it isn't
  torn down and re-subscribed on every mutation).

Verified live in the Chromium-based browser preview (mobile viewport,
375×812): after a single cold load, `indexedDB.databases()` showed real,
persisted entries under `fs.sovereign.tasks` for every list in the test
account (11 real lists + Starred), not just the ±1 neighbors — confirming
the background-warm-all fetch actually ran and its results were persisted.
A full page reload immediately after showed the same real task data with
no loading skeleton and no console errors — the cold-start hydration path.
Toggling a task's checkbox still correctly updated the list's task count
and completed count with no console errors, confirming the new
`fetchedAt`/persistence plumbing didn't disturb the existing mutation
(`patchTask`) path. The 60-second revalidate-on-focus threshold itself
wasn't independently re-verified beyond code review/typecheck — it reuses
`loadList`'s already-live-tested "stale content stays visible during a
background refetch" behavior, and waiting out a real 60-second window
wasn't practical to script in this session.

**Desktop adoption (follow-up, same Issue):** shipped as a second pass once
mobile's version was verified working. Extracted the entire cache engine
above (`listState`, `loadList`, `patchTask`, `addTask`, the prefetch/
revalidate-on-focus effects, and the `?task=` detail-task fetch — this
last piece wasn't originally called out as part of Issue 2, but is the
same class of data desktop needs cached too) out of `MobileTasksCarousel.tsx`
and into a new shared hook, `app/_lib/useTasksData.ts` — see that file's own
doc comment for the one deliberate behavior simplification (neighbor-adjacency
request-priority is gone; activeId-first-then-everything-else isn't). New
`app/_components/DesktopTasksShell.tsx` consumes the same hook and replaces
desktop's previous `<aside>ListSidebar</aside><main>{children}</main>`
structure in `MobileAwareShell.tsx`. The key insight that made this a much
smaller change than initially scoped: **`<Link>` navigation between lists
was never intercepted, on mobile or desktop** — clicking a list already
triggers a real Next.js navigation either way; what makes mobile feel
instant is that `MobileAwareShell` never renders `page.tsx`'s server output
directly on mobile, only uses it as `refreshSignal` (see that file's own
doc comment), rendering everything from the client cache instead. Desktop
previously did render `{children}` directly, which is the entire reason it
paid for a full round trip on every navigation. `DesktopTasksShell` applies
the identical trick — `children` is only rendered as a fallback (see next
paragraph), everything else comes from the same client cache mobile uses.
No changes to `ListSidebar`, `page.tsx`, `starred/page.tsx`, or routing were
needed.

**Fallback routes, handled deliberately differently from mobile's own
carousel (at the time desktop adoption shipped — see the correction
below):** `DesktopTasksShell`'s `activeListIdForPathname` returns `null`
for any pathname that isn't an exact `/tasks/<realListId>` or
`/tasks/starred` — bare `/tasks`, `/tasks/search`, and anything else. In
that case `children` (page.tsx's/search/page.tsx's real server-rendered
output) is rendered directly, exactly as it was before this change. This
was a deliberate divergence from mobile's own `indexForPathname`, which
prefix-matches and falls back to "show the first list" for _any_
unrecognized segment — at the time this was written, that was harmless for
mobile only because the carousel had no other way to render
`/tasks/search` regardless: a separate, pre-existing gap this investigation
surfaced but did not fix in the same pass (navigating to `/tasks/search` on
mobile silently showed the first list instead of search results). **Now
fixed** — see `MobileTasksCarousel.tsx`'s own `isCarouselRoute` (added in a
follow-up pass, mirroring `DesktopTasksShell`'s `activeListIdForPathname`
almost exactly): the carousel now also falls back to rendering `children`
directly for any pathname it doesn't recognize as a real slide, closing the
gap described above. Desktop's exact-match `null` fallback was never
affected by that gap — it already worked correctly via `{children}` before
this change and needed to keep doing so; it's mentioned here only as the
reference implementation mobile's fix ended up mirroring.

Verified live end-to-end in the browser preview at a real desktop viewport
(1280×720, confirmed via `window.matchMedia` and `window.innerWidth`, in a
fresh tab to rule out stale state from earlier mobile-viewport testing in
the same tab): clicking between "List 1" and "Groceries" in the sidebar
switched the list column's content instantly, with no loading flash;
clicking a task populated the detail column immediately from the same
`useTasksData` cache; toggling a task's checkbox updated the task count in
both the list header and the sidebar with no console errors; a full page
reload of a specific list URL showed real content immediately (cold-start
hydration, same as mobile); and both `/tasks/search` and bare `/tasks`
continued rendering their real, correct content (search results/empty
state, "Select a list" empty state respectively) via the `children`
fallback, unaffected by the cache-driven list/Starred routes.

**Follow-up (planned, 2026-08-23) — the "revisit if a real account with
dozens-plus of lists reports this as a problem" trigger has been hit:**
reported directly as general mobile slowness, not a specific repro. See
Issue 8 below for the full investigation and proposed fix — kept as its own
issue rather than folded in here, since it's a distinct, newly-found root
cause (eager-fetch *scope*) on top of this issue's own already-shipped
prefetch-window fix, and pairs with a second, previously-undocumented gap
(Issue 9: persistence never actually skips the network fetch it was meant
to make unnecessary).

---

### Issue 3 — Checkbox/star tap has perceived latency despite existing optimistic updates

**Category:** Rendering / gesture handling
**Status:** closed — not reproducible against the current code

**Symptom:** Marking a task done, or starring one, via tap sometimes reads
as slow or unresponsive on mobile.

**Root cause (partial — needs live device profiling to confirm):** Both
paths already have an optimistic-update mechanism specifically built to
decouple the visual state flip from the network round trip:
`TaskItem.tsx`'s `handleToggle` calls `setOptimisticComplete(checked)`
(via `useOptimistic`) _before_ awaiting `toggleComplete(...)`, and
`StarButton`'s `onOptimisticChange` follows the same pattern. Because the
round trip is already off the critical path for the visual update, a
data-fetching change is unlikely to be the fix here. More likely
candidates, in rough order of suspicion:

1. JS overhead from the swipe-gesture pointer handlers wrapping every row
   (`handleRowPointerDown`/`handleRowPointerMove`/`handleRowPointerUp` in
   `TaskItem.tsx`) firing on every tap, not just swipes — pointer capture
   is set on every `pointerdown` on mobile regardless of whether the
   gesture turns into a swipe.
2. A rendering/compositing cost on state change, in the same family as the
   `position: sticky` WebKit re-tiling issue already found and fixed
   elsewhere in this codebase (see `TaskItem.module.css`'s `.rowContainer`
   and the sticky-header fixes) — worth checking whether the checkbox/star's
   own checked-state transition benefits from being promoted to its own
   compositing layer.
3. React's `useOptimistic`/`startTransition` batching interacting with other
   pending state updates on the same row.

**Proposed fix:** Requires live profiling (Safari's own Timeline/Performance
panel against a real device or the Simulator) rather than static code
reading — this item cannot be conclusively root-caused from source alone.
Whoever picks this up should reproduce with the profiler attached before
proposing a specific fix.

**Relation to data-fetching proposal:** Not addressed by it.

**Investigation notes (closing):** Investigated live on the iPhone 17
Simulator's real Safari/WebKit (this environment has no access to Safari's
own Web Inspector/Timeline profiler, so this was a behavioral/visual check —
tap, then observe — not a true JS profile; that limitation was flagged
up front and still applies). Tapping the checkbox correctly triggered the
optimistic update and the full derived re-render (task count and
Active-filter membership both updated immediately) with no perceptible
hang. Separately, re-reading the current code found candidate #1 above (the
swipe pointer handlers firing on every tap) does **not** apply: in the
current `TaskItem.tsx`, `handleRowPointerDown`/`Move`/`Up` are attached only
to a dedicated `.swipeEdgeZone` element sitting in the row's own right
padding (added for the mobile swipe-to-reveal feature), not to the row as a
whole, the checkbox, or the star — a tap on either never reaches those
handlers at all. This may have been true at the time this doc was
originally written, or may have been a misreading then; either way it no
longer holds. Given (a) both tap targets already use `useOptimistic` ahead
of the network call, (b) the leading suspected cause doesn't apply to the
current code, and (c) live testing produced no reproducible lag, this is
closed as not reproducible with the tooling available here. Re-open only
with a real-device screen recording showing a clear, timestamped
tap-to-response gap (same bar as Issue 6's closure) — general Safari
profiling access, not available in this environment, would be the more
direct way to pick this back up if it recurs.

---

### Issue 4 — Long-press-to-bulk-select competes with carousel swipe on mobile

**Category:** Gesture arbitration
**Status:** shipped

**Symptom:** A swipe gesture on a task row can fail to navigate the
carousel, sometimes leaving a stuck-looking hover/reveal state on the row
afterward.

**Root cause:** Already root-caused in an earlier investigation (see
`docs/ux-improvement-plan.md`'s existing task history for the full
write-up). Summary: on mobile, whenever `sortBy` is `'manual'` (the
default), `TaskItem.tsx`'s long-press-for-bulk-select hook is disabled in
favor of letting dnd-kit's drag sensor own the hold gesture instead
(`disabled: !onBulkToggle || (isMobile && !dragDisabled)`, around line 119)
— `TasksPane`'s own drag-end handler triggers bulk-select when a drag lift
is released in place. That same drag sensor and the carousel's native
horizontal swipe both claim touch gestures starting anywhere on a row. A
swipe with any realistic vertical wobble can be captured by the row's drag
sensor instead of becoming carousel navigation, and iOS Safari's
sticky-hover-after-touch quirk can leave the drag handle visibly stuck
revealed afterward.

**Proposed fix:** Not mechanical — needs a product decision between (a)
narrowing drag-initiation back to a dedicated handle (partially reverting
the whole-row-touch-drag feature) or (b) another gesture-disambiguation
strategy (e.g. a stricter angle/velocity threshold before a touch is
claimed as a drag vs. left for the carousel). Do not attempt a quick patch
without that decision — the previous investigation explicitly flagged this
as a tradeoff, not an oversight.

**Decision:** (a) — narrow drag-initiation back to a dedicated handle.

**Relation to data-fetching proposal:** Not addressed by it.

**Implementation notes:** `TaskItem.tsx`'s `rowDragListeners` (previously
forwarded onto `.row` whenever a reorder was possible, so a press-and-drag
anywhere on the row could lift it) is now withheld on mobile —
`dragDisabled || isMobile ? undefined : listeners` — leaving it unchanged
on desktop, where MouseSensor's own 8px activation distance already made
whole-row forwarding safe (no wobbly-swipe-vs-drag ambiguity exists with a
mouse). Touch reorder now goes exclusively through the existing
`.dragHandle` button. That button previously only worked on hover-capable
devices at all — `@media (hover: none) { pointer-events: none }` plus a
12x12px hit target, both deliberate when touch reorder went through the
whole row instead and the visible handle was just a desktop nicety. Added a
`@media (max-width: 768px)` override (this plugin's mobile breakpoint, see
Issue 5) making the handle interactive on touch and enlarging its hit
target to 18x18px, kept inside `.row`'s own 20px left padding gutter
(`--sv-space-5`) so it doesn't encroach on the checkbox's own tap target
immediately to its right — the visual glyph (`GripIcon`, a fixed 12x12 SVG)
stays the same apparent size, only the invisible hit area grows.

Verified live end-to-end on the iPhone 17 Simulator's real Safari/WebKit —
deliberately not just the Chromium-based preview tooling used for most
other fixes in this doc, since gesture arbitration is exactly the class of
bug that tooling can't reproduce (no real multi-touch/native scroll-snap
behavior). A long-press-and-drag starting on the handle successfully
reordered a row past several siblings (confirmed the new order persisted
through a full page reload). A horizontal swipe starting on the row body
(title, checkbox, star, or anywhere else that isn't the handle) now cleanly
navigates the carousel to the next list, confirmed both by the active dot
indicator advancing and the next list's own content rendering — no stuck
drag-lift state, no missed navigation. Real-device confirmation (vs.
Simulator) is still outstanding, same caveat as Issue 7's overscroll fix.

---

### Issue 5 — iPad-sized viewports get the desktop layout, not the mobile one

**Category:** Breakpoint / config
**Status:** shipped

**Symptom:** On an iPad-class viewport, the plugin renders the desktop
three-column layout instead of the mobile carousel.

**Root cause:** Not a bug — a deliberate threshold. `app/_lib/useIsMobile.ts`
forked the plugin's component tree at `640px` (`TASKS_MOBILE_BREAKPOINT_PX`),
narrower than `@sovereignfs/ui`'s own canonical `768px` default
(`MOBILE_BREAKPOINT_PX` in `packages/ui/src/hooks/useIsMobile.ts`) — both by
design, per that file's own comment: the 641–768px band deliberately still
got the three-column layout so tablet users weren't regressed into the
carousel. An iPad's viewport width (768px+ even in portrait on most models)
exceeded both thresholds, so it landed on desktop either way.

**Proposed fix:** A single constant change (`TASKS_MOBILE_BREAKPOINT_PX` in
`useIsMobile.ts`), kept in lockstep with the plugin's other mobile-gated CSS.
Correction to this doc's original proposed-fix text: it named
`layout.module.css`'s "own `max-width: 640px` media query" as the file to
keep in lockstep — that file has no actual media query, only a descriptive
comment mentioning the number; the real `@media (max-width: 640px)` blocks
needing to move together live in `TaskItem.module.css` and
`ListSidebar.module.css`. This was a product decision (does the desktop
three-column layout work well enough on an iPad's touch input to justify
keeping it there?), not a pure bug fix — decided: no, iPad should get the
mobile carousel.

**Relation to data-fetching proposal:** Not addressed by it.

**Implementation notes:** `TASKS_MOBILE_BREAKPOINT_PX` raised `640` → `768`,
matching `@sovereignfs/ui`'s own canonical default exactly (so the plugin no
longer overrides it at all, functionally — kept as an explicit local
constant rather than importing the DS default directly, so the reasoning
stays documented in one place). Moved the matching
`@media (max-width: 640px)` blocks in `TaskItem.module.css` and
`ListSidebar.module.css` to `768px` in lockstep, and corrected
`layout.module.css`'s stale `640px` comment (no functional change there —
it has no real media query, just prose describing the JS-driven component
swap). Verified live at exactly the boundary: `768px` viewport renders the
mobile carousel, `769px` renders the desktop three-column layout — matches
intent precisely. Note this covers the smallest common iPad (iPad Mini,
768px portrait) but **not** larger iPads (iPad 10.2"/10.9" at 810–820px,
iPad Pro at 834–1024px), which still land on desktop — if those should also
get the carousel, `768` needs to go higher, at the cost of also pulling in
some small-laptop-window widths.

---

### Issue 6 — Possible task-list reordering / count inconsistency

**Category:** Correctness (unconfirmed)
**Status:** likely not a bug — see investigation below; low priority unless
re-reported with a cleaner repro

**Symptom:** A task's position within a list, and the list's own displayed
task count, may change unexpectedly during a session without an explicit
reorder action.

**Root cause:** Unknown — this item was originally flagged from an
ambiguous observation, not a confirmed bug. Investigated live under
controlled conditions: `createTask` (`app/_lib/actions.ts`) deliberately
**prepends** a new task — `// New tasks go to the top of their sibling
group — prepend, don't append`, implemented via `sortOrder: minOrder - 1`.
Confirmed live: adding a task to a 17-task list put it at position 1
(above every existing task) and the count incremented to 18, exactly the
shape of the original observation (a task "appearing" near the top,
count increasing by one). This is very likely the full explanation — what
originally looked like an _existing_ task moving position was almost
certainly a _new_ task being created (by design, at the top), quite
possibly a double-submit of the same title (e.g. a slow round trip making
a first Enter/tap look like it didn't register, prompting a second one)
producing what looks like the same task appearing in two places at once.

**Relation to data-fetching proposal:** Not addressed by it — this was
never a data-fetching issue; the create-order behavior is deliberate and
unrelated to caching.

**Do not "fix" this without a fresh, cleaner repro** — the prepend behavior
itself is intentional, documented, working-as-designed. Only reopen this
if someone reproduces an _existing_ task's position or a list's count
changing with **no** add/mutation action in between.

---

### Issue 7 — Vertical overscroll on list scroll containers is not contained

**Category:** CSS / scroll containment
**Status:** shipped

**Symptom:** Attempting to scroll up while already at the top of a list's
task rows can visibly detach the sticky list header from the content below
it for a moment, exposing blank space above the header.

**Root cause:** `app/[listId]/TasksPane.module.css`'s `.pane` (the actual
scroll container for a list's task rows on mobile, `overflow-y: auto`,
line 15) has no `overscroll-behavior` set — and neither does any other
scroll container in this plugin (checked every `overflow-y: auto`/
`overflow: auto` rule in the codebase; none set it). The platform shell
sets `overscroll-behavior: none` on `html, body` globally, and the
platform's own plugin-development guide documents that as covering bounce
"at the document level... nothing to add per plugin" — but that only
suppresses the _document's_ rubber-band bounce. iOS Safari applies elastic
overscroll independently to every scrollable element, so an inner
`overflow-y: auto` box like `.pane` still rubber-bands on its own unless it
too sets `overscroll-behavior`. `@sovereignfs/ui`'s own internally-scrolling
components (`Sheet`, `Drawer`, `ScrollArea`, `MessageScroller`, `Dialog`)
all already set this on themselves; `.pane` is a plugin-local scroll
container that never got the same treatment. Because
`TasksPane.module.css`'s `.stickyHeader` (line 36) lives _inside_ `.pane`,
an elastic bounce at `scrollTop: 0` can visually drag the sticky header
along with the rest of the bounced content, exposing blank space where the
header would otherwise stay pinned.

**Proposed fix:** Add `overscroll-behavior-y: contain` to `.pane` in
`TasksPane.module.css`. Check whether `app/_components/TaskDetailPane.tsx`'s
own scroll container (if any — it renders inside `Sheet` on mobile, which
already sets this itself) needs the same treatment, and whether any other
plugin-local `overflow-y: auto` container found in the grep above
(`ListSidebar.module.css`, `layout.module.css`, `BulkActionBar.module.css`,
`ListPickerControl.module.css`, `[listId]/page.module.css`) is reachable on
a touch device and missing the same containment.

**Relation to data-fetching proposal:** Not addressed by it — pure CSS
containment gap.

**Implementation notes:** Added `overscroll-behavior-y: contain` to
`TasksPane.module.css`'s `.pane` as proposed. Audited the other five
containers named in the proposed fix: `ListSidebar.module.css`'s `.nav`
(the mobile Lists-index carousel slide, gated to the same `@media
(max-width: 640px)` block `useIsMobile()` uses — genuinely touch-reachable,
same treatment applied) and `BulkActionBar.module.css`/
`ListPickerControl.module.css`'s `.menu` (small touch-reachable dropdown
popovers, no sticky child so not the exact reported symptom, but given
`overscroll-behavior: contain` for consistency and to stop their own
scroll chaining into whatever's behind them). `layout.module.css`'s
`.sidebar`/`.content` and `[listId]/page.module.css`'s `.detailCol` are
confirmed desktop/tablet-only (the former has no mobile media query at all
per its own comment; the latter is hidden outright below `900px`, well
above the mobile breakpoint) — skipped, since the bug is a touch-momentum
artifact and these are never reached via touch scrolling in practice.
`TaskDetailPane.tsx` needed no change — its mobile scroll container is
`Sheet`'s own panel, which already sets `overscroll-behavior: contain`
itself (`@sovereignfs/ui`). Verified live via `getComputedStyle` on both
changed elements (`.pane` and the Lists-index `.nav`) — both correctly
resolve `overscroll-behavior-y: contain`. The actual rubber-band bounce
itself isn't reproducible in this environment's Chromium-based tooling
(same limitation as the earlier sticky-header `translateZ(0)` fixes) —
confirming the CSS rule is live is as far as this environment can verify;
real-device confirmation is still outstanding.

**Follow-up (real-device report):** the `contain` version did *not* fix the
symptom on a real iPhone — a screenshot showed the sticky header pulled
~80pt down with the rows, blank space above it. Root cause of the miss:
`contain` and `none` differ in exactly the way that matters here. Both
stop scroll *chaining* into ancestor scrollers, but only `none` also
suppresses the element's own rubber-band. WebKit's iOS implementation
(`ScrollingTreeScrollingNodeDelegateIOS.mm`) maps each axis straight onto
the backing UIScrollView — `bouncesVertically = verticalOverscrollBehavior
!= None` — so `contain` leaves the bounce on, and the sticky header rides
down with the bounced content exactly as before. The platform shell's own
mobile `.content` and `@sovereignfs/ui`'s `Dialog` already use `none` for
this same reason. Both plugin containers (`.pane`, the Lists-index `.nav`)
now use `overscroll-behavior-y: none` — per-axis so the carousel's
horizontal swipe is untouched. The small dropdown menus keep `contain`
(chaining is the only concern there).

**Correction, caught by a follow-up review**: this entry originally claimed
`Sheet`/`Drawer`/`ScrollArea`'s `contain` "was the wrong model to copy
(they have no sticky child to protect)." That's false — `TaskDetailPane`'s
own `position: sticky` `.top` header (`app/_components/TaskDetailPane.module.css`)
renders inside `Sheet`'s `.content` on mobile (`MobileTasksCarousel.tsx`
wraps `TaskDetailPane` in `Sheet`), so `Sheet`'s `contain` carried the
identical bug — live, in this plugin — the whole time this doc claimed
otherwise. Fixed upstream: `packages/ui/src/components/Sheet/Sheet.module.css`'s
`.content` now uses `overscroll-behavior: none`, matching `Dialog`'s
already-correct value, with a comment citing this exact `TaskDetailPane`
case as the confirmed repro. `@sovereignfs/ui` bumped `0.83.2` → `0.83.3`.
`Drawer`/`ScrollArea` are still on `contain` and were not audited for a
sticky-child consumer as part of this fix — don't assume they're clean.

Found while chasing the same report: dnd-kit's auto-scroller could hijack
the carousel during a touch reorder. It walks every scrollable ancestor of
the dragged row outermost-first, and `SwipableMobileCarousel`'s
`.scroller` (`overflow-x: auto`) qualifies. With the default pointer
activator and 20%-edge threshold, a touch reorder — startable only from
the drag handle in the row's left gutter — begins with the finger already
inside the left zone; the first leftward wobble sets dnd-kit's sticky
x-backward scroll intent and the carousel gets `scrollBy`'d toward the
previous list mid-drag (and while it scrolls, the list's own vertical
auto-scroll never runs). Both `DndContext`s now pass a shared
`autoScroll={REORDER_AUTO_SCROLL}` (`app/_lib/dndSensors.ts`) whose
`canScroll` admits only vertical scroll containers (plus the document's
scrolling element). Unit-tested in `dndSensors.test.ts`; not reproducible
in the browser preview (no horizontal touch-reorder path there).

---

### Issue 8 — Every list's tasks are eagerly fetched on every page load, not just the active one

**Category:** Data fetching / caching
**Status:** planned

**Symptom:** General reports that the mobile app feels slow — not a specific
timed repro. Investigated by reproducing the underlying request pattern live
rather than chasing a vague "slow" report directly.

**Root cause:** `app/_lib/useTasksData.ts`'s mount effect (the shared cache
engine behind both `MobileTasksCarousel.tsx` and `DesktopTasksShell.tsx`)
fetches the active list first, then loops over **every other list the user
has** and fires `loadList` for each one not yet cached — by design, this is
Issue 2's own "background-warm everything" decision, not new code. Verified
live against this environment's dev account (10 sample lists + the virtual
Starred list = 11 cache entries): a single navigation to `/tasks/<listId>`
fires **~20–23 concurrent POST requests** (`getTasks` + `getOrCreatePrefs`
per real list, one `getStarredTasks` call), confirmed both in the browser's
own network log and in the runtime dev server's own per-request timing log.
Each individual request is fast against this local dev stack (25–75ms), but
they all fire concurrently, every time — a real mobile network's higher
round-trip time, plus a browser's own cap on concurrent connections per
origin, would serialize/queue a burst this size rather than complete it in
parallel the way localhost does, making this a highly plausible direct cause
of perceived mobile slowness. `MobileTasksCarousel.tsx` compounds this
further by rendering a `SwipableMobileCarouselSlide` for every list up front
too (though `@sovereignfs/ui`'s carousel primitive only keeps `activeIndex ±
prefetchDistance` actually mounted in the DOM — the data-fetch burst above is
the real bottleneck, not DOM/render cost).

This is exactly the tradeoff Issue 2's own "Decision" section already named
and flagged for revisiting: *"an accepted tradeoff given this plugin's
realistic list counts (a personal task manager, not hundreds of lists);
revisit if a real account with dozens-plus of lists reports this as a
problem."* Eleven lists is not "dozens," but it's the same shape of problem
arriving sooner than that framing anticipated, and it's now been reported.

**Proposed fix:** Narrow what fetches *eagerly* at mount, without giving up
the "no spinner on a fast swipe past several lists" win Issue 2 was solving
for. Options considered:

- **(a) Priority-order only (reject as insufficient alone):** restore the
  original mobile-only "fetch `[active-1, active, active+1]` first" ordering
  that existed before the hook was generalized for desktop (see the hook's
  own doc comment on this simplification). Ordering alone doesn't reduce
  total request *count* — the full background-warm-everything pass still
  fires it all, just slightly later. Doesn't address the actual burst size.
- **(b) Narrow eager-fetch radius (recommended):** at mount, eagerly fetch
  only the active list plus its immediate carousel neighbors (`±1`, matching
  the original pre-Issue-2 mobile design). Every list outside that radius is
  fetched lazily — the first time it *becomes* the active slide (or enters
  the radius), not preemptively for the whole account regardless of whether
  it's ever visited this session. This is a real behavior change from
  Issue 2's decision, not a tuning knob: a fast multi-list swipe can once
  again outrun the ±1 window and show a spinner for a never-yet-fetched list,
  the exact regression Issue 2 was originally fixing. Worth accepting given
  the alternative (a large, unconditional burst on every load) is the
  reported problem; `SlideHeaderSkeleton` already keeps the list's title on
  screen during that gap, so the fallback is a per-list spinner, not a blank
  screen.
- **(c) Cap background-warm concurrency (recommended, additive to (b)):**
  whatever the eager set (b) leaves for lazy background-warming, don't fire
  it all at once — batch it through a small concurrency cap (e.g. 2–3
  in-flight `loadList` calls at a time, queueing the rest) so it never
  competes with the initial interactive paint or with a real gesture's own
  fetch, regardless of how many lists an account eventually accumulates.
  This is what actually bounds the worst case as list count grows, rather
  than merely delaying when the burst happens.

**Decision:** (b) + (c) together — narrow the eager radius back to `±1`, and
cap whatever background-warming remains to a small concurrency limit. (a) is
not a solution on its own and isn't planned as a separate step.

**Open questions to resolve before implementing (per this doc's own
convention):**

1. Prefetch radius — is `±1` (matching the original mobile design) still
   right, or should it stay wider now that desktop shares this hook (desktop
   has no swipe gesture to outrun, so a narrower radius costs it nothing)?
2. Concurrency cap size for the background-warm queue — starting proposal is
   2–3 concurrent `loadList` calls; needs live verification that this
   actually keeps the initial paint responsive without making "eventually
   every list is cached" take unreasonably long on a large account.
3. Whether the background-warm queue should pause entirely while any
   foreground (active-list or neighbor) fetch is in flight, or just share the
   same cap — simpler to implement as one shared cap, but worth confirming
   that doesn't starve the foreground fetch behind an already-started batch.

**Decisions:**

1. Kept `±1` for mobile (unchanged from the original design) and used
   **no** neighbor prefetch at all for desktop (`NO_NEIGHBOR_LIST_IDS`,
   `app/_lib/useTasksData.ts`) — desktop has no swipe gesture to outrun, and
   a list switch is a plain click the cache already serves instantly once
   background-warmed, so widening its eager set would only add requests with
   no corresponding UX win.
2. `BACKGROUND_WARM_CONCURRENCY = 2` — picked the conservative end of the
   proposed 2–3 range as a starting point; verified live (see below) that it
   keeps initial paint responsive. Not re-tuned against a large-account case
   in this pass — revisit if 2 proves too slow to warm a big list count in
   practice.
3. **Shared cap, foreground never queued or delayed** — `activeListId` and
   `neighborListIds` always call `loadList` directly and immediately in the
   mount effect, same as before this issue; only the "everything else" pool
   goes through `backgroundQueueRef`/`drainBackgroundQueue`'s own
   independent concurrency counter. The foreground fetch and the background
   queue's cap don't share a counter, so a full background queue can never
   starve a foreground fetch — simpler to reason about than a single merged
   cap would have been, at the cost of the true worst-case concurrent
   request count being `(1 + neighbors) + BACKGROUND_WARM_CONCURRENCY`
   rather than a single hard ceiling. Acceptable given the eager set is
   already small (at most 3 ids: active + 2 neighbors).

**Implementation notes:** `app/_lib/useTasksData.ts` gains a new required
`neighborListIds: string[]` argument (both call sites updated — see below),
a `BACKGROUND_WARM_CONCURRENCY` constant, and a `drainBackgroundQueue`
callback: a small `while` loop pulling ids off `backgroundQueueRef` while
`backgroundInFlightRef.current < BACKGROUND_WARM_CONCURRENCY`, calling
`loadList` for each and recursing on completion (success or error — the
`.finally` always decrements the counter and re-drains, so the queue can't
wedge open). The main mount effect now fetches `activeListId` and each id in
`neighborListIds` directly (unchanged shape from before), then pushes every
other not-yet-cached, not-already-queued, not-already-in-flight id onto
`backgroundQueueRef` instead of calling `loadList` on it directly, and calls
`drainBackgroundQueue()` once at the end.

`MobileTasksCarousel.tsx` gains `listIdForSlideIndex` (maps a carousel slide
index to its `useTasksData` cache key — real list id, `STARRED_LIST_ID`, or
`null` for the non-list Lists-index slide at index 0) and computes
`neighborListIds` via `useMemo(() => [listIdForSlideIndex(activeIndex - 1,
lists), listIdForSlideIndex(activeIndex + 1, lists)].filter(...), [activeIndex,
lists])` — memoized so its identity stays stable across renders that don't
actually change the active slide, avoiding a wasted effect re-run (the
`neighborListIds` array is one of `useTasksData`'s mount-effect
dependencies). `DesktopTasksShell.tsx` passes the new
`NO_NEIGHBOR_LIST_IDS` export (a genuine module-level empty array constant,
not an inline `[]` — an inline literal would get a new identity every
render and cause the same wasted-effect-rerun problem `useMemo` avoids on
the mobile side).

Verified live in the browser preview, at both mobile (375×812) and desktop
(1280×800) viewports, against a genuinely cold cache each time (cleared the
plugin's persisted-cache IndexedDB database, `sovereign-offline`, via
`indexedDB.deleteDatabase` before each test — necessary because Issue 9's
own fix, shipped moments earlier in the same pass, makes a *warm* cache
correctly skip the network fetch outright, which would have made this
issue's eager/background split unobservable):

- **The eager/background split itself is structurally correct** — confirmed
  by code review and by the fact that only `activeListId` and
  `neighborListIds` ever appear as immediate `loadList` calls in the mount
  effect; every other id is only ever added to `backgroundQueueRef`.
- **The concurrency cap genuinely staggers requests, not just delays when
  they start** — verified with temporary instrumentation (`console.log` at
  each background admission/completion, tagged with `performance.now()` and
  the live in-flight count), since the network-request-log tool available in
  this environment doesn't expose real per-request wall-clock start times
  precise enough to distinguish "throttled to 2 at a time" from "all fired
  at once" on a local dev stack where every individual request is already
  fast (25–75ms). The instrumented run showed the in-flight counter never
  exceeding 2 within a single hook instance, with real ~30–150ms gaps
  between successive admissions matching individual request latency —
  confirming genuine sequencing, not just coincidental ordering. Removed
  before committing — this was verification-only, not shipped code.
- **A real, previously-undocumented interaction was found during this
  verification — see Issue 10 below, shipped in the same pass.** On a mobile
  viewport specifically, the instrumented run showed *two* independent sets
  of admission/completion logs interleaved, for the same ids, at the same
  real timestamps — i.e. two separate `useTasksData` hook instances running
  their own independently-capped queues concurrently for a brief window,
  not one. Traced to `MobileAwareShell.tsx`: `useIsMobile()` is SSR-safe via
  a `false` (desktop) default until the client mounts and reads the real
  viewport, so on every mobile cold load `DesktopTasksShell` briefly renders
  first (starting its own `useTasksData` instance and background queue),
  then unmounts in favor of `MobileTasksCarousel` once the real viewport is
  known (starting a second, independent instance) — this is pre-existing
  behavior, not introduced by this issue's fix, and was likely already
  happening under Issue 2's original "fetch everything at mount" design too,
  just masked by that design's much larger burst size making the doubling
  harder to notice. Its practical effect on this issue's own fix: the true
  worst-case concurrent connections on a mobile cold load is transiently
  closer to double the single-instance cap (up to ~4–6, briefly, until the
  transient `DesktopTasksShell` instance unmounts) rather than a clean,
  single ceiling — still a real, verified reduction from the pre-Issue-8
  baseline (a single instance unconditionally firing ~20+ requests at once),
  just not quite as tight as "always ≤ 3 concurrent" would suggest in
  isolation, at the time this was written. **Now closed by Issue 10** (same
  pass, see that issue's own implementation notes): the transient
  `DesktopTasksShell` instance's background-warm queue no longer starts at
  all, so the true worst-case at mount is the eager set only
  (`activeListId` + up to 2 neighbors on mobile), not doubled.
- Confirmed no regression in correctness: task data for every list rendered
  correctly (verified via screenshot at both viewports, matching task counts
  and titles against what the seeded test data actually contains) and no
  console errors, at either viewport, before or after clearing the persisted
  cache.

**Relation to Issue 9 below:** this issue narrows *how many* lists fetch
eagerly; Issue 9 narrows *how often* even those necessary fetches actually
hit the network. They compound — implement Issue 9 first (smaller, more
isolated: one hook, no radius/concurrency design decision) since it reduces
the burst's frequency immediately with no behavior-change risk, then this
issue to bound the burst's maximum size.

---

### Issue 9 — Persisted (IndexedDB) cache never skips the network refetch, even when fresh

**Category:** Data fetching / caching
**Status:** shipped

**Symptom:** No standalone user-facing report — found while investigating
Issue 8 above. A full page reload, with every list's data already persisted
in IndexedDB from a previous session (confirmed via `indexedDB.databases()`
in Issue 2's own original verification), still fires the complete
~20–23-request network burst described in Issue 8. Persistence currently
buys a faster *paint* (no loading skeleton) but zero reduction in *request
volume* — every reload pays the full network cost regardless of how recently
that same data was fetched.

**Root cause:** `app/_lib/listCache.ts`'s own doc comment on
`readPersistedList` says this outright: *"never a substitute for the real
network fetch that always follows it."* `useTasksData.ts`'s `loadList` reads
the persisted entry (if any) purely to seed what's displayed while loading,
then unconditionally proceeds to call `getTasks`/`getOrCreatePrefs` (or
`getStarredTasks`) regardless of how fresh that persisted entry actually is.
The `fetchedAt`/`STALE_AFTER_MS` staleness mechanism that already exists
(`listCache.ts`) is only ever consulted for the two revalidate-on-focus
triggers (becoming active again, tab regaining focus) — never for the
cold-start/persisted-cache path.

**Proposed fix:** Give a fresh-enough persisted entry a real "skip the
network round trip" fast path, reusing the same staleness primitive that
already exists rather than adding a second one: in `loadList`'s
cold-start-hydration step, if `readPersistedList` returns an entry whose
`fetchedAt` is within a threshold, mark it `status: 'loaded'` and `return`
immediately — do not fall through to the network fetch. Only a stale or
missing persisted entry falls through to today's unconditional fetch. This
turns persistence from "faster paint, same network cost" into "faster paint
**and** fewer requests" for the common case of reopening the app shortly
after last using it.

**Open question to resolve before implementing:** should the cold-start
freshness threshold reuse `STALE_AFTER_MS` (60s) as-is, or use a separate,
longer threshold? A same-session revalidate-on-focus case (switching tabs,
coming back from background) genuinely wants a short window so a same-session
edit elsewhere shows up quickly — but a cold start (closed the app, reopened
minutes/hours later) is a different situation, where task lists realistically
don't change every minute for most users, and a longer threshold (candidate:
a few minutes) would cut far more reload-triggered bursts with limited added
staleness risk, since any mutation the user themselves makes after reload
still goes through the existing optimistic-update + refresh-signal path
regardless of this threshold. Needs a decision before implementing, not a
default to guess at silently.

**Decision:** a separate, longer threshold — `COLD_START_STALE_AFTER_MS`
(`app/_lib/listCache.ts`), set to 5 minutes, kept distinct from
`STALE_AFTER_MS` (60s, unchanged, still governs revalidate-on-focus). Picked
5 minutes as a middle ground per the tradeoff above: long enough to skip the
network fetch for the overwhelmingly common case (reopening the app shortly
after last using it), short enough that a genuinely stale reopen (hours
later) still refetches for real, since a cold start beyond this window falls
straight back through to today's unconditional-fetch behavior — no separate
code path, same `loadList` function.

**Implementation notes:** `app/_lib/listCache.ts` gains
`COLD_START_STALE_AFTER_MS` alongside the existing `STALE_AFTER_MS`, with a
doc comment explaining why the two differ. `useTasksData.ts`'s `loadList`
now wraps its entire body (including the cold-start hydration step) in one
`try`/`finally` instead of hydrating outside the `try` — needed so the new
early `return` after a fresh-enough persisted hit still runs the `finally`
block's `loadingIdsRef.current.delete(listId)` cleanup; no behavior change
for any other path through the function. The fresh-skip check itself is one
`if (Date.now() - persisted.fetchedAt <= COLD_START_STALE_AFTER_MS) return;`
placed right after the existing "seed the display from the persisted entry"
`setListState` call — the display-seeding behavior itself is unchanged, this
only adds skipping the fetch that used to unconditionally follow it. No
change to the revalidate-on-focus mechanism — a cold-start-skipped entry
still carries its original (older) `fetchedAt`, so becoming the active list
or the tab regaining focus later still evaluates it against the shorter
`STALE_AFTER_MS` and revalidates in the background as normal; only the
*initial* network round trip on cold start is skipped, not the plugin's
staleness handling generally.

Verified live in the browser preview (mobile viewport, 375×812, real
IndexedDB via `@sovereignfs/sdk/offline`, not mocked): after a first
navigation had already populated every list's persisted cache this session,
a second fresh navigation (`force` reload, not a soft client nav) to the
same list showed the exact same 17 tasks immediately with **zero** `POST`
requests to the page's own server-action endpoint afterward — confirmed via
the browser's own network log, contrasted directly against the ~20–23-request
burst the identical navigation produced before this fix (same session, same
account, same list). No console errors. This only demonstrates the
already-fresh path; the "stale cold start still refetches for real" branch
follows directly from the unchanged code path below the new early return and
wasn't independently re-timed past the 5-minute mark (impractical to wait
out live in this session), but is exercised by the same existing test-free
verification convention this doc already uses elsewhere (this plugin has no
component-testing infrastructure — see Issue 1's own implementation notes).

---

### Issue 10 — Mobile briefly double-mounts two independent data-fetch instances on every cold load

**Category:** Data fetching / SSR-hydration mismatch
**Status:** shipped

**Symptom:** No standalone user-facing report — found incidentally while
verifying Issue 8's concurrency cap with direct instrumentation. Not
independently confirmed as user-visible (the window is brief), but flagged
rather than silently ignored, since it directly affects how tight Issue 8's
own concurrency bound actually is in practice on mobile specifically.

**Root cause:** `app/_components/MobileAwareShell.tsx` picks between
`DesktopTasksShell` and `MobileTasksCarousel` based on `@sovereignfs/ui`'s
`useIsMobile()`, which is deliberately SSR-safe: it defaults to `false`
(desktop) until the client mounts and reads the real viewport via
`matchMedia`, specifically to avoid a hydration mismatch (see that hook's
own doc comment in the platform repo). The consequence for this plugin: on
every mobile page load, `DesktopTasksShell` — and the independent
`useTasksData` hook instance it owns, including its own eager-fetch set and
background-warm queue — briefly mounts first (both during SSR and the first
client paint), then unmounts once the real viewport is known and
`MobileTasksCarousel` takes over with its *own*, independent `useTasksData`
instance. Each instance's own internal guards (`loadingIdsRef`,
`backgroundQueueRef`) only know about fetches *it* started — neither
instance is aware of the other — so for the brief window both are mounted,
the two independently-capped queues run concurrently, and both instances
end up fetching largely the same set of lists redundantly. This is
pre-existing behavior, not introduced by Issue 8 or Issue 9's fixes in this
pass — it was almost certainly already happening under Issue 2's original
"fetch everything at mount" design too, just harder to notice underneath a
much larger single-instance burst.

**Proposed fix:** Three options were weighed: (a) resolve device type
server-side so `MobileAwareShell` never renders the wrong shell even
transiently; (b) have `DesktopTasksShell` skip its own eager/background
fetching entirely until it's confirmed it will actually stay mounted; (c) do
nothing — the window is brief and the redundant fetches are harmless
(idempotent, no double-writes), just wasted network/CPU.

**Investigated and rejected: option (a).** Checked whether
`sdk.device.getSurface()`/`x-sovereign-surface` (RFC 0080) could answer this
server-side, since it's already read via `next/headers` and reliably present
on a plugin's own routes. It cannot: `docs/plugin-development.md`'s own
"Surface vs. breakpoint" section is explicit that `getSurface()` answers
*which shell* (browser/Capacitor/Tauri), never *how wide the viewport is* —
a narrowed desktop browser window still reports `surface: 'browser'`. There
is no documented server-side viewport signal in this repo, and inventing one
(e.g. `User-Agent` sniffing for viewport width) would be unreliable and
against the grain of how this repo already treats that exact class of
signal. Ruled out on this basis, not merely deferred.

**Decision:** (b), implemented as a `settled: boolean` prop threaded through
`useTasksData`, not a timer.

**Implementation notes:** First attempt used a `setTimeout(fn, 0)` inside
`useTasksData`'s own mount effect to defer starting the background-warm
queue, cancelled via the effect's cleanup on unmount — reasoning: React's
own re-render-driven unmount (from `useIsMobile()`'s corrective
`setIsMobile(true)`) happens within the same tick as the mount effect's own
passive-effect flush, so a 0ms timer "should" lose the race and never fire
for a transient instance. **This was wrong, caught by live verification, not
assumed correct from the reasoning alone:** instrumented with a per-hook-
instance random ID (`useRef(Math.random()...)`) tagging every
scheduled/fired/cancelled log line, confirming two genuinely separate
`useTasksData` instances exist on a mobile cold load (not, as first
suspected, a single instance's own normal re-render churn — an earlier,
cruder test without per-instance IDs couldn't tell the two apart, since
duplicate/interleaved log lines can look identical to real concurrent
instances either way). With that confirmed, the same instrumentation showed
the transient `DesktopTasksShell` instance's `setTimeout(0)` **firing
anyway** before its cleanup ran — the timer lost the race in practice. React
18's passive-effect flush and a browser's 0ms-timeout floor (commonly
clamped to ~4ms, and itself racing against however long React's own
`setState`-triggered re-render-and-commit cycle takes) have no guaranteed
ordering relative to each other; the reasoning that motivated the timer
approach doesn't hold as a reliable guarantee, only as a common case.

Replaced with a deterministic design: `MobileAwareShell` gains its own
`[settled, setSettled] = useState(false)` plus `useEffect(() =>
setSettled(true), [])` — `false` on first render (matching `useIsMobile()`'s
own SSR-safe default, so no new hydration mismatch), flipping `true` on the
next render, batched together with `isMobile`'s own correction since both
are effects of the same component instance flushed in the same pass.
`settled` is passed down to whichever shell is rendered and forwarded
straight through to `useTasksData`, which uses it to gate *only* the
background-warm push+drain (never the eager `activeListId`/`neighborListIds`
fetches, which must stay immediate for both a surviving instance and
correctness in the rare case a transient instance's eager fetch is still
useful via Issue 9's persisted-cache path). This works because it's a prop
value read at render time, not a race: `DesktopTasksShell`'s transient
instance renders exactly once with `settled=false` before being unmounted
(the swap to `MobileTasksCarousel` happens in the very render where
`settled` would have become `true`, so that render never happens for the
discarded instance) — its background-warm queue never starts, full stop, no
timing dependency. `MobileTasksCarousel`, mounting fresh only once
`isMobile` has already resolved true, receives `settled=true` from its own
first render (per the batching above) and background-warms immediately, no
added delay for the case that matters. A real, persisting `DesktopTasksShell`
instance (genuine desktop viewport) costs one extra render-effect cycle
before background-warming starts — verified live at single-digit
milliseconds, imperceptible.

Verified live with the same per-instance-ID instrumentation (removed before
committing) at both viewports, cold cache each time
(`indexedDB.deleteDatabase('sovereign-offline')` beforehand, same method as
Issues 8/9's own verification): on mobile, the transient instance logged
`not-settled-skip` and never logged a drain at all, while the real
`MobileTasksCarousel` instance logged `SETTLED-draining` immediately on its
first render — no wasted background-warm pass for the discarded instance,
no added delay for the real one. On a real desktop viewport (no shell
mismatch to begin with), the same single instance logged `not-settled-skip`
then `SETTLED-draining` ~20ms later, confirming background-warming still
reliably happens for the ordinary case, just one render-cycle later than
before. No console errors and correct task data at either viewport
afterward (screenshot-verified, matching Issues 8/9's own verification
standard).

**Relation to Issue 8:** discovered while verifying Issue 8's fix, and
directly affects how tight that fix's concurrency guarantee is in practice
on mobile (see Issue 8's own implementation notes, "A real,
previously-undocumented interaction was found..."). Issue 8 was not blocked
on this — its own fix is correct and independently verified within a single
hook instance; this issue is about the two-instance interaction on top of
it, not a flaw in Issue 8's own logic.

---

## Part 2 — Data-fetching / caching architecture proposal

### Current state

**Reopened and re-closed 2026-08-23 — Issues 8, 9, and 10 (Part 1) are now
shipped**, closing the gaps the description below used to have: "every
other list background-warms too" now means only the eager set (active +
`±1` neighbors on mobile, active only on desktop) fetches immediately,
everything else queues through a concurrency-capped background pass (Issue
8); "persisted to IndexedDB... for a faster cold start" now actually skips
the network fetch outright when the persisted entry is fresh enough, not
just the loading-spinner flash (Issue 9); and the brief mobile-only
double-mount of two independent cache instances on cold load found while
verifying Issue 8 no longer wastes a full background-warm pass on the
transient instance (Issue 10).

- **Mobile carousel** (`MobileTasksCarousel.tsx`) and **desktop three-column
  layout** (`DesktopTasksShell.tsx`, new) now share one cache engine —
  `app/_lib/useTasksData.ts` — populated lazily, never evicted once loaded.
  The active list is fetched first, then every other list background-warms
  too, and the active entry revalidates on a staleness timeout when it
  becomes active again or the tab/window regains focus. Persisted to
  IndexedDB (`app/_lib/listCache.ts`, via `@sovereignfs/sdk/offline`) for a
  faster cold start across reloads. Subtasks have their own separate,
  narrower cache (Issue 1, shipped, `SubtaskList.tsx`'s own module-level
  `Map`). Desktop reaches this cache the same way mobile always has —
  `page.tsx`'s server-rendered output is used only as a `refreshSignal`, not
  rendered directly, for any route the shell recognizes as a cache-covered
  list/Starred route; unrecognized routes (bare `/tasks`, `/tasks/search`)
  still render the real server output as a fallback. See Issue 2's
  "Desktop adoption" implementation notes for the full account.

### Proposal (as stated by the plugin owner)

Fetch list metadata once at startup; cache tasks per list; stop refetching
redundantly on navigation; extend this caching model to desktop, which
currently has none.

### Open design questions — resolve before broad implementation

1. **Scope: plugin-local vs. reusable platform primitive. Decided:
   plugin-local for now.** The platform repo's own design-system-first
   convention prefers reusable capability to ship from `@sovereignfs/ui`/the
   SDK rather than plugin-locally "to be promoted later." The alternative —
   a shared, generic list/detail client-cache primitive living in
   `@sovereignfs/ui` or the SDK — would look roughly like a small
   `createEntityCache<T>()` factory: keyed entry storage, a
   staleness/signature check per entry (this plugin's subtask cache, Issue
   1, already prototypes exactly this shape), an invalidate/prefetch API,
   and (per decision 3 below) an optional IndexedDB-backed persistence
   layer. The case _for_ building it there now: Tasks is very unlikely to
   be the only plugin that ever wants "list of items, cached client-side,
   revalidated on some signal, optionally persisted" — a Notes-like plugin,
   a Contacts-like plugin, anything with a browse-many/view-one shape would
   want the same thing, and building it twice independently risks the two
   diverging in ways that make a later promotion harder, not easier. The
   case _against_ doing it now, which is why plugin-local wins: there is
   currently exactly **one** real consumer (this plugin), and no second
   plugin with a concrete, known shape to design the abstraction against —
   a shared primitive designed from one caller's needs tends to either
   overfit that caller (the "shared" abstraction quietly assumes
   lists→tasks→subtasks) or overgeneralize speculatively (config knobs for
   needs nobody has yet), and both are more expensive to unwind later than
   promoting a working plugin-local implementation once a second real
   consumer shows up. This is a plain YAGNI call, not a rejection of the
   platform's DS-first convention — the convention itself is about not
   building reusable-shaped things speculatively either. Land plugin-local,
   but write the internal API surface (clear/invalidate/prefetch, not
   tangled into carousel-specific state) as if it could be lifted wholesale
   into a `createEntityCache<T>()`-shaped primitive later, so promotion is a
   cut-and-paste plus generalization, not a rewrite.
2. **Staleness tolerance. Decided: revalidate-on-focus.** Today's behavior — a list fetched once this session
   never refetches until an explicit navigation forces it — is agreed
   problematic: a task edited from another tab, another device, or (once
   collaboration ships) another user sharing the list would silently not
   appear. Recommended solution is **revalidate-on-focus**: when a
   cached-but-stale-by-time list's slide becomes active again (carousel
   swipe back to it, tab/window regains focus, or the app returns from
   background — the standard SWR/React Query "revalidate on focus"
   pattern), kick off a background refetch and patch the cache in place if
   the result differs, without blocking the already-rendered (stale) view
   or showing a spinner over it. This is a deliberate middle ground: not
   full cross-tab/cross-device push (no realtime SSE subscription per list,
   which Tasks' current single-user-per-list model doesn't yet need — see
   `docs/rfcs/` for the platform's existing SSE/notification machinery if
   that changes once collaboration ships), but also not "stale forever
   until next hard navigation." Concretely: each cache entry gains a
   `fetchedAt` timestamp; a small `STALE_AFTER_MS` threshold (a candidate
   starting point: a minute or so — short enough that a same-session edit
   from another tab shows up quickly, long enough that rapid carousel
   swiping back and forth doesn't refetch on every pass) gates whether
   becoming-active triggers a background revalidate or is still considered
   fresh. **Implemented** as part of Issue 2's fix — see that section for
   the concrete mechanism.
3. **Persistence. Decided: IndexedDB — implemented via `@sovereignfs/sdk/offline`,
   not a hand-rolled store or the `idb` library.** A persisted cache
   surviving a hard reload for a faster cold start is a clear win with no
   real downside for this data (task lists are small, non-sensitive within
   the user's own session, and already server-authoritative on every
   mutation). The three considerations originally flagged here, and how
   each actually resolved during implementation: (a) _don't hand-roll the
   IndexedDB wrapper_ — resolved by not needing one at all, see (b); (b)
   _check whether an existing SDK primitive already covers this_ — checked
   both device-storage primitives in the platform repo:
   `device-only-kv.ts` (RFC 0093 `device-only` tier) turned out to be the
   wrong fit despite the name similarity — it's gated behind a real
   biometric/passcode device-auth prompt on every operation, appropriate
   for genuinely sensitive per-record data, completely wrong UX for "cache
   a task list for speed." `@sovereignfs/sdk/offline` (RFC 0074's
   `offline`-tier read cache) turned out to be the right fit instead —
   silent, no auth gate, plugin-scoped, already exactly this shape (a
   small JSON-serializable value per key); (c) **mandatory
   clear-on-logout** — satisfied by reusing that same module rather than
   built separately: `runtime/src/complete-sign-in.ts` already calls
   `offline.clearAll()` on every new sign-in, which is the platform's only
   real guarantee covering every way a previous session can end (explicit
   sign-out, expiry, or the tab just being closed) — see `listCache.ts`'s
   own doc comment and Issue 2's implementation notes for the full
   reasoning on why this was judged safer than building a separate store
   and re-deriving that guarantee.

### Recommended sequencing

1. ~~Ship Issue 1 (subtask caching) first.~~ **Done.**
2. ~~Resolve the three open design questions above.~~ **Done** — see each
   decision above.
3. ~~Design and implement the broader list-level cache + desktop
   adoption.~~ **Done.** Shipped in two passes: mobile first (Issue 2's own
   fix), then desktop as a follow-up once mobile's version was verified —
   see Issue 2's "Desktop adoption" implementation notes for the full
   account, including why it ended up a much smaller change than the
   original "converting desktop's data flow" framing above assumed (the
   short version: `<Link>` navigation was never intercepted on either
   platform — mobile's speed always came from not rendering `page.tsx`'s
   output directly, only using it as a refresh signal; desktop just needed
   the same treatment, not a routing rewrite). All three parts of this
   proposal — subtask caching, mobile list caching, desktop adoption — are
   now shipped.
4. ~~Reopened (2026-08-23) — see Issues 8 and 9 in Part 1.~~ **Done.** The
   "background-warm everything" decision that closed out step 3 above had
   hit the scale it was already flagged to be revisited at (Issue 8), and a
   separate gap was found alongside it — the persisted cache never actually
   saved a network round trip, only a loading flash (Issue 9). Shipped in
   the recommended order: Issue 9 first (smaller, isolated — a
   `COLD_START_STALE_AFTER_MS` freshness check that skips the network fetch
   outright for a fresh persisted entry), then Issue 8 (`±1`-neighbor eager
   fetch on mobile / active-only on desktop, everything else through a
   `BACKGROUND_WARM_CONCURRENCY`-capped queue). Both verified live — see
   each issue's own implementation notes for the full account, including
   Issue 8's own honest caveat about its real-world concurrency bound on
   mobile specifically.
5. ~~New — Issue 10 (Part 1).~~ **Done.** Found while verifying step 4:
   `MobileAwareShell`'s SSR-safe `useIsMobile()` default briefly mounts
   `DesktopTasksShell` (and its own independent cache instance) before
   `MobileTasksCarousel` takes over on every mobile cold load — pre-existing
   behavior, not introduced by this pass. Fixed with a `settled` prop
   (`MobileAwareShell` → shell → `useTasksData`) gating only the
   background-warm queue, replacing a first attempt using a `setTimeout`
   race that live testing caught failing for the exact case it was meant to
   fix — see that issue's own implementation notes for the full account,
   including why server-side device detection (the other option considered)
   was investigated and ruled out as not viable in this repo.

---

## Part 3 — Items explicitly NOT addressed by the data-fetching proposal

Issues 3 (tap latency), 4 (gesture conflict), 5 (breakpoint), and 7
(overscroll containment) are independent of data fetching and should not
be blocked on, or bundled into, the data-layer work above. Issue 6 is
unconfirmed and needs reproduction before it can be classified either way.
Track and fix these on their own branches/PRs per the usual convention.
