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

| #   | Issue                                                                       | Category                     | Data-fetching proposal addresses it? | Status                             |
| --- | --------------------------------------------------------------------------- | ---------------------------- | ------------------------------------ | ---------------------------------- |
| 1   | Subtask list refetches on every expand/collapse                             | Data fetching                | Yes — directly                       | shipped                            |
| 2   | Fast swiping through not-yet-visited lists shows a spinner per list         | Data fetching                | Yes — partially (prefetch scope)     | shipped (mobile) — desktop pending |
| 3   | Checkbox/star tap has perceived latency despite existing optimistic updates | Rendering / gesture handling | No                                   | closed — not reproducible          |
| 4   | Long-press-to-bulk-select competes with carousel swipe on mobile            | Gesture arbitration          | No                                   | shipped                            |
| 5   | iPad-sized viewports get the desktop layout, not the mobile one             | Breakpoint / config          | No                                   | shipped                            |
| 6   | Possible task-list reordering / count inconsistency                         | Correctness (unconfirmed)    | No                                   | likely not a bug                   |
| 7   | Vertical overscroll on list scroll containers is not contained              | CSS / scroll containment     | No                                   | shipped                            |

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
**Status:** shipped (mobile) — desktop adoption still pending, see Part 2

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

---

## Part 2 — Data-fetching / caching architecture proposal

### Current state

- **Mobile carousel** (`MobileTasksCarousel.tsx`): keeps its own
  client-side cache (`listState`, keyed by list id), populated lazily,
  never evicted once loaded. As of Issue 2's fix (shipped), the
  mount/`activeIndex`-change effect eagerly prefetches the active slide ±1
  neighbor first, then background-warms every other list too, and
  revalidates the active entry on a staleness timeout when it becomes
  active again or the tab/window regains focus. Persisted to IndexedDB
  (`app/_lib/listCache.ts`, via `@sovereignfs/sdk/offline`) for a faster
  cold start across reloads. Subtasks have their own separate, narrower
  cache (Issue 1, shipped, `SubtaskList.tsx`'s own module-level `Map`).
- **Desktop three-column layout**: no client-side cache. Every navigation
  between lists is a full server round trip through Next.js routing
  (`page.tsx` re-fetches on every route change). There is currently no
  mobile-carousel-equivalent decoupled cache on desktop at all — **still
  true after Issue 2's fix**, which only touched the mobile carousel; see
  "Recommended sequencing" below for why desktop adoption is deliberately a
  separate, not-yet-started follow-up.

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
3. ~~Design and implement the broader list-level cache~~ **Done for
   mobile** — see Issue 2's implementation notes. **Desktop adoption is
   still not started** and is deliberately being kept as its own separate
   follow-up rather than folded into the same change: desktop's current
   data flow (`page.tsx` as a plain server component, re-fetching
   everything fresh on every route change via Next.js's own routing) is
   architecturally unrelated to the mobile carousel's client-driven,
   never-unmounted SPA-in-a-tab model that `listState`/`listCache.ts` were
   built against — adopting the same caching approach there means either
   converting desktop's data flow to be client-cache-driven too (a real,
   separate architectural change touching `TasksPane`, `ListSidebar`, and
   `TaskDetailPane`'s prop flow, not a drop-in reuse of what mobile just
   got) or finding a different, desktop-appropriate mechanism (e.g. leaning
   on Next.js's own `<Link>` prefetching, not yet investigated for whether
   it already provides some of this for free). Desktop currently has no
   reported bug or complaint driving this — Issue 2's own symptom was
   mobile-swipe-specific — so there's no urgency forcing it into the same
   push as a bounded, already-verified mobile fix. Whoever picks this up
   next should start by investigating Next.js's built-in prefetch behavior
   for this route shape before assuming a full rewrite is necessary.

---

## Part 3 — Items explicitly NOT addressed by the data-fetching proposal

Issues 3 (tap latency), 4 (gesture conflict), 5 (breakpoint), and 7
(overscroll containment) are independent of data fetching and should not
be blocked on, or bundled into, the data-layer work above. Issue 6 is
unconfirmed and needs reproduction before it can be classified either way.
Track and fix these on their own branches/PRs per the usual convention.
