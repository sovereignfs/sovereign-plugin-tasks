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

| #   | Issue                                                                       | Category                     | Data-fetching proposal addresses it? | Status                                   |
| --- | --------------------------------------------------------------------------- | ---------------------------- | ------------------------------------ | ---------------------------------------- |
| 1   | Subtask list refetches on every expand/collapse                             | Data fetching                | Yes — directly                       | shipped                                  |
| 2   | Fast swiping through not-yet-visited lists shows a spinner per list         | Data fetching                | Yes — partially (prefetch scope)     | planned                                  |
| 3   | Checkbox/star tap has perceived latency despite existing optimistic updates | Rendering / gesture handling | No                                   | planned                                  |
| 4   | Long-press-to-bulk-select competes with carousel swipe on mobile            | Gesture arbitration          | No                                   | planned (known, previously investigated) |
| 5   | iPad-sized viewports get the desktop layout, not the mobile one             | Breakpoint / config          | No                                   | planned                                  |
| 6   | Possible task-list reordering / count inconsistency                         | Correctness (unconfirmed)    | No                                   | likely not a bug                         |
| 7   | Vertical overscroll on list scroll containers is not contained              | CSS / scroll containment     | No                                   | shipped                                  |

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
**Status:** planned

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

**Relation to data-fetching proposal:** Directly in scope, but blocked on
design decisions — see Part 2.

---

### Issue 3 — Checkbox/star tap has perceived latency despite existing optimistic updates

**Category:** Rendering / gesture handling
**Status:** planned

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

---

### Issue 4 — Long-press-to-bulk-select competes with carousel swipe on mobile

**Category:** Gesture arbitration
**Status:** planned (known, previously investigated, intentionally left
unfixed pending a product decision)

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

**Relation to data-fetching proposal:** Not addressed by it.

---

### Issue 5 — iPad-sized viewports get the desktop layout, not the mobile one

**Category:** Breakpoint / config
**Status:** planned

**Symptom:** On an iPad-class viewport, the plugin renders the desktop
three-column layout instead of the mobile carousel.

**Root cause:** Not a bug — a deliberate threshold. `app/_lib/useIsMobile.ts`
forks the plugin's component tree at `640px`
(`TASKS_MOBILE_BREAKPOINT_PX`), narrower than `@sovereignfs/ui`'s own
canonical `768px` default (`MOBILE_BREAKPOINT_PX` in
`packages/ui/src/hooks/useIsMobile.ts`) — both by design, per that file's
own comment: the 641–768px band deliberately still gets the three-column
layout so tablet users aren't regressed into the carousel. An iPad's
viewport width (768px+ even in portrait on most models) exceeds both
thresholds, so it lands on desktop either way.

**Proposed fix:** If iPad should use the mobile carousel, this is a single
constant change (`TASKS_MOBILE_BREAKPOINT_PX` in `useIsMobile.ts`), but
must stay in lockstep with `layout.module.css`'s own `max-width: 640px`
media query per that file's own comment — both need to move together, or
the two layout trees can end up disagreeing about which one should be
active at a given width. This is a product decision (does the desktop
three-column layout actually work well enough on an iPad's touch input to
justify keeping it there?), not a pure bug fix.

**Relation to data-fetching proposal:** Not addressed by it.

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
  client-side cache (`listState`, keyed by list id), populated lazily.
  Never evicts an entry once loaded. The mount/`activeIndex`-change effect
  only eagerly prefetches the active slide ± 1 neighbor (see Issue 2).
  Subtasks have no caching layer at all (Issue 1).
- **Desktop three-column layout**: no client-side cache. Every navigation
  between lists is a full server round trip through Next.js routing
  (`page.tsx` re-fetches on every route change). There is currently no
  mobile-carousel-equivalent decoupled cache on desktop at all.

### Proposal (as stated by the plugin owner)

Fetch list metadata once at startup; cache tasks per list; stop refetching
redundantly on navigation; extend this caching model to desktop, which
currently has none.

### Open design questions — resolve before broad implementation

1. **Scope: plugin-local vs. reusable platform primitive.** The platform
   repo's own design-system-first convention prefers reusable capability to
   ship from `@sovereignfs/ui`/the SDK rather than plugin-locally "to be
   promoted later." A generic list/detail client-cache primitive is
   plausible as a shared capability, but this plugin's own data shape
   (lists → tasks → subtasks) may not generalize cleanly to every plugin's
   needs. Default recommendation: design the shape as if it could be
   promoted (clear cache/invalidate/prefetch API surface, not tangled into
   carousel-specific state), but land the first implementation plugin-local
   given the open questions below aren't yet resolved.
2. **Staleness tolerance.** Is "stale until the next navigation triggers a
   refetch" acceptable (current mobile behavior), or does this need
   cross-tab/cross-device freshness (e.g. a task edited in another session
   should be reflected here without an explicit navigation)? This
   materially changes the design — a pure client cache with no
   invalidation signal cannot satisfy the latter without some form of
   push/poll mechanism.
3. **Persistence.** In-memory only (current mobile behavior — lost on a
   hard reload) vs. a persisted store (e.g. IndexedDB) that survives a
   reload for a faster cold start.

### Recommended sequencing

1. **Ship Issue 1 (subtask caching) first.** Narrow, self-contained, no
   open design questions block it, and it directly validates the caching
   approach at small scale before committing to the bigger design.
2. **Resolve the three open design questions above** — ideally with the
   plugin owner directly, since they're product/UX tradeoffs, not
   technical unknowns.
3. **Design and implement the broader list-level cache + desktop
   adoption** as a follow-up once scope is settled, informed by what Issue
   1's implementation surfaces in practice.

---

## Part 3 — Items explicitly NOT addressed by the data-fetching proposal

Issues 3 (tap latency), 4 (gesture conflict), 5 (breakpoint), and 7
(overscroll containment) are independent of data fetching and should not
be blocked on, or bundled into, the data-layer work above. Issue 6 is
unconfirmed and needs reproduction before it can be classified either way.
Track and fix these on their own branches/PRs per the usual convention.
