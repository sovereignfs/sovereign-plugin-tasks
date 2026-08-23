'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetailTask } from '../_components/TaskDetailPane';
import { getOrCreatePrefs, getStarredTasks, getTask, getTasks } from './actions';
import {
  COLD_START_STALE_AFTER_MS,
  persistList,
  readPersistedList,
  STALE_AFTER_MS,
} from './listCache';
import type { ListRow, TaskRow } from './types';
import { STARRED_LIST_ID } from './virtualLists';

/**
 * Shared client-side list/task cache backing both `MobileTasksCarousel`
 * (every slide, all the time) and `DesktopTasksShell` (the one active list
 * column + detail column) — findings doc Issue 2 / Part 2. Extracted from
 * `MobileTasksCarousel`'s original, plugin-local, all-slides-inline
 * implementation once desktop needed the identical logic, rather than
 * duplicating ~250 lines of cache/staleness/persistence handling a second
 * time — see `docs/data-fetching-and-mobile-interaction-findings.md`'s
 * "Recommended sequencing" for the desktop-adoption decision this backs.
 *
 * Eager-fetch scope (findings doc Issue 8, revised from Issue 2's original
 * "background-warm everything, all at once" decision once that tradeoff was
 * actually hit by a normal-sized account): only `activeListId` and the
 * caller-supplied `neighborListIds` fetch immediately at mount. Every other
 * list is queued and background-warmed through a small concurrency cap
 * (`BACKGROUND_WARM_CONCURRENCY` below) instead of firing all at once — so
 * request *count* at mount now scales with the eager set (small, bounded),
 * not with total list count, while every list still eventually ends up
 * cached exactly as before. `neighborListIds` is caller-supplied because
 * only the caller knows what "adjacent" means for its own presentation —
 * carousel-slide adjacency on mobile, nothing on desktop (no swipe gesture
 * to outrun there — see `DesktopTasksShell`'s own use of this hook).
 */

/** How many background-warm `loadList` calls (everything outside the eager
 *  set — see the module doc comment above) may be in flight at once. Kept
 *  small and deliberately independent of any foreground fetch (active list,
 *  neighbors) — those are never queued or delayed by this cap, only the
 *  "get to it eventually" pool is throttled. Not derived from list count —
 *  a fixed, small number bounds the worst case regardless of how many lists
 *  an account accumulates. */
const BACKGROUND_WARM_CONCURRENCY = 2;

/** Stable empty array for callers with no neighbor concept (desktop) — a
 *  fresh `[]` literal on every render would change `neighborListIds`'
 *  identity and re-run the mount effect below on every render for no
 *  reason. */
export const NO_NEIGHBOR_LIST_IDS: string[] = [];

export interface ListState {
  tasks: TaskRow[];
  showCompleted: boolean;
  status: 'loading' | 'loaded' | 'error';
  /** `Date.now()` this entry was last fetched from the server — `0` for an
   *  entry that was never successfully fetched. Drives the
   *  revalidate-on-focus check below; see `listCache.ts`'s `STALE_AFTER_MS`. */
  fetchedAt: number;
}

interface UseTasksDataArgs {
  lists: ListRow[];
  /** The list id (or `STARRED_LIST_ID`) the caller currently considers
   *  active — loaded/revalidated first, and what the detail-task fetch
   *  below is scoped to reload alongside. `null` when there's no single
   *  active list (e.g. desktop's bare `/tasks` index or `/tasks/search`,
   *  which fall back to real server rendering instead of this cache — see
   *  `DesktopTasksShell`). */
  activeListId: string | null;
  /** Ids (real list ids and/or `STARRED_LIST_ID`) to fetch eagerly at mount
   *  alongside `activeListId` — findings doc Issue 8. On mobile this is the
   *  carousel's immediate `±1` slide neighbors, restoring the original
   *  pre-Issue-2 mobile design (see the module doc comment); pass
   *  `NO_NEIGHBOR_LIST_IDS` (not a fresh `[]` — see that constant's own doc
   *  comment) for a caller with no adjacency concept, e.g. desktop. Every
   *  list outside `[activeListId, ...neighborListIds]` still gets fetched,
   *  just through the concurrency-capped background queue instead of
   *  immediately. */
  neighborListIds: string[];
  /** Whether the caller's own mobile-vs-desktop shell choice has settled —
   *  findings doc Issue 10. `false` gates off *only* the background-warm
   *  queue (push + drain) below, never the eager fetch above, so it costs
   *  nothing visible: a caller that's about to unmount in favor of a
   *  different shell (see `MobileAwareShell`'s own `settled` state, the
   *  concrete case this exists for) never starts fetching every other list
   *  only to discard the result a render later; a caller that survives
   *  re-renders once `settled` flips `true` (typically the very next tick)
   *  and background-warming proceeds exactly as before. Deliberately a
   *  prop, not a timer — see this file's own git history for why an
   *  earlier `setTimeout`-based attempt at this was dropped: unmounting is
   *  driven by React's own render scheduling, which has no fixed relationship
   *  to a timer's delay, so a timer can lose the race it's meant to win. */
  settled: boolean;
  /** The `?task=` query param, or `null`. Drives the detail-task fetch. */
  taskIdParam: string | null;
  /** Opaque value that changes identity on every server refresh elsewhere
   *  in the plugin (any `router.refresh()` call inside `TasksPane`/
   *  `TaskDetailPane`/etc.) — read only for its identity, as a trigger to
   *  re-fetch the active list and detail task, never for its value. */
  refreshSignal: unknown;
}

export function useTasksData({
  lists,
  activeListId,
  neighborListIds,
  settled,
  taskIdParam,
  refreshSignal,
}: UseTasksDataArgs) {
  const [listState, setListState] = useState<Record<string, ListState>>({});
  const [detailTask, setDetailTask] = useState<DetailTask | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const isFirstRefreshSignal = useRef(true);
  // Tracks listIds with a fetch currently in flight — a ref, not state, so a
  // second loadList(id) call that lands before the first resolves can see it
  // synchronously and no-op instead of firing a duplicate set of server
  // actions.
  const loadingIdsRef = useRef<Set<string>>(new Set());
  // Always-fresh mirror of listState for loadList to read without taking a
  // dependency on it — plain assignment during render, not an effect, so it
  // never lags a render behind. loadList's own useCallback deps stay `[]` so
  // its identity — and every effect keyed on it — stays stable across every
  // listState change.
  const listStateRef = useRef(listState);
  listStateRef.current = listState;
  // Background-warm queue (Issue 8) — ids waiting for a free concurrency
  // slot, and a count of how many background-triggered loadList calls are
  // currently in flight. Both refs, not state: purely internal scheduling
  // bookkeeping with no rendering implication of its own (listState is what
  // actually drives render output once each load resolves).
  const backgroundQueueRef = useRef<string[]>([]);
  const backgroundInFlightRef = useRef(0);

  const loadList = useCallback(async (listId: string) => {
    if (loadingIdsRef.current.has(listId)) return;
    loadingIdsRef.current.add(listId);

    try {
      // Cold-start hydration (findings doc Issue 2 / Part 2 — IndexedDB
      // persistence via listCache.ts): a list with no in-memory entry yet
      // this session (typically right after a page reload) gets one last
      // chance to show real content instead of a loading skeleton, from
      // whatever was persisted the last time it was fetched. Best-effort — a
      // miss just falls through to the normal fetch-then-show flow below.
      if (!listStateRef.current[listId]) {
        const persisted = await readPersistedList(listId);
        if (persisted) {
          setListState((s) =>
            s[listId] ? s : { ...s, [listId]: { ...persisted, status: 'loaded' } },
          );
          // Issue 9: a persisted entry fresh enough to trust outright skips
          // the network fetch entirely, instead of only seeding the display
          // while a fetch always follows anyway (this used to be
          // unconditional — see COLD_START_STALE_AFTER_MS's own doc comment
          // for why this threshold is longer than STALE_AFTER_MS below).
          // The list still revalidates normally once it's actually visited
          // (becomes the active list) or the tab regains focus while stale.
          if (Date.now() - persisted.fetchedAt <= COLD_START_STALE_AFTER_MS) {
            return;
          }
        }
      }

      setListState((s) => {
        const existing = s[listId];
        // A background refresh (e.g. router.refresh() after toggling a
        // checkbox re-fires this for the active list via the refreshSignal
        // effect below) should keep showing the already-loaded tasks while
        // the refetch happens, not flip back to the "Loading…" placeholder.
        // The hydration step above already gives the same "stay loaded,
        // refresh quietly" treatment to a persisted-cache hit. 'loading' is
        // reserved for a list with genuinely nothing to show yet.
        const status = existing?.status === 'loaded' ? 'loaded' : 'loading';
        return {
          ...s,
          [listId]: {
            tasks: existing?.tasks ?? [],
            showCompleted: existing?.showCompleted ?? false,
            fetchedAt: existing?.fetchedAt ?? 0,
            status,
          },
        };
      });

      // The Starred slide has no per-list prefs row (it's not a real list) —
      // showCompleted stays a session-local false, same default as a fresh
      // real list's own showCompleted before any prefs row exists.
      if (listId === STARRED_LIST_ID) {
        const tasks = await getStarredTasks();
        const entry = { tasks, showCompleted: false, fetchedAt: Date.now() };
        setListState((s) => ({ ...s, [listId]: { ...entry, status: 'loaded' } }));
        persistList(listId, entry);
        return;
      }
      const [tasks, prefs] = await Promise.all([getTasks(listId), getOrCreatePrefs(listId)]);
      const entry = { tasks, showCompleted: prefs?.showCompleted ?? false, fetchedAt: Date.now() };
      setListState((s) => ({ ...s, [listId]: { ...entry, status: 'loaded' } }));
      persistList(listId, entry);
    } catch {
      setListState((s) => ({
        ...s,
        [listId]: { tasks: [], showCompleted: false, fetchedAt: 0, status: 'error' },
      }));
    } finally {
      loadingIdsRef.current.delete(listId);
    }
  }, []);

  // Pulls up to BACKGROUND_WARM_CONCURRENCY ids off the queue and starts
  // loading them, refilling a slot the moment each one finishes (success or
  // error — loadList's own finally always clears loadingIdsRef, so a
  // background load can't wedge the queue open forever). Safe to call
  // liberally (mount, and recursively from each completion) — it's a no-op
  // whenever the queue is empty or already at the concurrency cap.
  const drainBackgroundQueue = useCallback(() => {
    while (
      backgroundInFlightRef.current < BACKGROUND_WARM_CONCURRENCY &&
      backgroundQueueRef.current.length > 0
    ) {
      const id = backgroundQueueRef.current.shift();
      if (!id) break;
      // Already resolved or already being fetched by something else (e.g. it
      // became the active list between being queued and its turn coming up)
      // — nothing left for the background pass to do for it.
      if (listStateRef.current[id] || loadingIdsRef.current.has(id)) continue;
      backgroundInFlightRef.current += 1;
      void loadList(id).finally(() => {
        backgroundInFlightRef.current -= 1;
        drainBackgroundQueue();
      });
    }
  }, [loadList]);

  // Synchronously patches the cached tasks the moment an optimistic toggle
  // (completion, star) fires inside a row — see StarButton's
  // onOptimisticChange doc comment for why. Without this, listState stays
  // stale until loadList's own refetch (triggered by refreshSignal, some
  // time after this same toggle's transition has already settled)
  // eventually catches up, causing a visible revert-then-reapply flicker.
  const patchTask = useCallback((taskListId: string, taskId: string, patch: Partial<TaskRow>) => {
    setListState((s) => {
      const entry = s[taskListId];
      if (!entry) return s;
      return {
        ...s,
        [taskListId]: {
          ...entry,
          tasks: entry.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
        },
      };
    });
  }, []);

  const patchDetailTask = useCallback((patch: Partial<DetailTask>) => {
    setDetailTask((t) => (t ? { ...t, ...patch } : t));
  }, []);

  // Mirrors patchTask above, for the add-task path — see TasksPane's
  // onTaskAdded doc comment for why this is needed.
  const addTask = useCallback((taskListId: string, task: TaskRow) => {
    setListState((s) => {
      const entry = s[taskListId];
      if (!entry) return s;
      return { ...s, [taskListId]: { ...entry, tasks: [...entry.tasks, task] } };
    });
  }, []);

  // Fetch the active list and its caller-supplied neighbors eagerly, then
  // queue every other not-yet-cached list through the concurrency-capped
  // background-warm pass (findings doc Issue 8 — narrowed from Issue 2's
  // original "fetch everything, all at once" once that tradeoff was
  // actually hit by a normal-sized account). Also revalidates the active
  // entry if it's gone stale since it was last fetched (revalidate-on-focus,
  // trigger 1: becoming active again).
  useEffect(() => {
    if (activeListId && !listState[activeListId]) loadList(activeListId);

    if (activeListId) {
      const entry = listState[activeListId];
      if (entry?.status === 'loaded' && Date.now() - entry.fetchedAt > STALE_AFTER_MS) {
        loadList(activeListId);
      }
    }

    for (const id of neighborListIds) {
      if (id !== activeListId && !listState[id]) loadList(id);
    }

    // Findings doc Issue 10: the background-warm push+drain only runs once
    // `settled` is true — gated on a prop, not a timer (an earlier attempt
    // using setTimeout(0) as a "let a same-tick unmount win the race" delay
    // was dropped: React's own re-render-driven unmount has no fixed timing
    // relationship to a timer's delay, so the timer sometimes lost the race
    // it was meant to win, verified live). `settled` starts `false` on any
    // caller matching its SSR default (see `MobileAwareShell`'s own
    // `settled` state) and flips `true` on that caller's next render if it
    // survives — for `DesktopTasksShell` specifically, briefly mounted
    // ahead of `MobileTasksCarousel` on an actual mobile viewport, that next
    // render never happens: it's unmounted first, so the background-warm
    // pass — the wasteful "fetch every other list" work — never starts at
    // all, deterministically. Deliberately does NOT gate the eager fetches
    // above (activeListId/neighborListIds) — those are the only part that
    // affects visible content, and must stay immediate for both a surviving
    // instance and correctness in the rare case a transient instance's
    // eager fetch is still useful (e.g. its cache entry persists and Issue
    // 9's cold-start check picks it up later).
    if (settled) {
      const eagerIds = new Set(
        [activeListId, ...neighborListIds].filter((id): id is string => id !== null),
      );
      const allIds = [STARRED_LIST_ID, ...lists.map((l) => l.id)];
      for (const id of allIds) {
        if (
          !eagerIds.has(id) &&
          !listState[id] &&
          !loadingIdsRef.current.has(id) &&
          !backgroundQueueRef.current.includes(id)
        ) {
          backgroundQueueRef.current.push(id);
        }
      }
      drainBackgroundQueue();
    }
    // listState intentionally excluded from deps — it's the effect's own
    // output (loadList's setListState calls), not an input that should retrigger it.
  }, [activeListId, neighborListIds, settled, lists, loadList, drainBackgroundQueue]);

  // Revalidate-on-focus, trigger 2: the tab/window regains focus while a
  // stale-by-time list is already active (e.g. the user switched apps for a
  // while and came back). Registered once — reads the latest state via refs
  // rather than depending on it directly, so this listener isn't torn down
  // and re-added on every mutation.
  const activeListIdRef = useRef(activeListId);
  activeListIdRef.current = activeListId;
  useEffect(() => {
    function revalidateActiveIfStale() {
      if (document.visibilityState !== 'visible') return;
      const id = activeListIdRef.current;
      if (!id) return;
      const entry = listStateRef.current[id];
      if (entry?.status === 'loaded' && Date.now() - entry.fetchedAt > STALE_AFTER_MS) {
        loadList(id);
      }
    }
    document.addEventListener('visibilitychange', revalidateActiveIfStale);
    window.addEventListener('focus', revalidateActiveIfStale);
    return () => {
      document.removeEventListener('visibilitychange', revalidateActiveIfStale);
      window.removeEventListener('focus', revalidateActiveIfStale);
    };
  }, [loadList]);

  // Re-fetch the active list whenever a mutation elsewhere triggers a server
  // refresh (see refreshSignal's doc comment above). Skips the first fire,
  // which coincides with the initial mount already covered by the effect above.
  useEffect(() => {
    if (isFirstRefreshSignal.current) {
      isFirstRefreshSignal.current = false;
      return;
    }
    if (activeListId) loadList(activeListId);
    // Any mutation, wherever it happens, can change the Starred aggregate —
    // most commonly starring/unstarring a task while viewing a different,
    // real list. Only refetch it if it's already been loaded once — matches
    // this hook's "never eagerly fetch a list nobody has viewed" approach
    // (moot in practice now that everything background-warms at mount, but
    // kept as a correct guard rather than assuming that always won the race).
    if (activeListId !== STARRED_LIST_ID && listStateRef.current[STARRED_LIST_ID]) {
      loadList(STARRED_LIST_ID);
    }
    // Intentionally only keyed on refreshSignal — activeListId/loadList/
    // listState are read at fire-time, not triggers for re-running this
    // effect themselves.
  }, [refreshSignal]);

  // Detail overlay/column: driven by the ?task= param.
  useEffect(() => {
    if (!taskIdParam) {
      setDetailTask(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getTask(taskIdParam)
      .then((t) => {
        if (!cancelled) {
          setDetailTask(t as DetailTask | null);
          setDetailLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetailTask(null);
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [taskIdParam, refreshSignal]);

  return { listState, loadList, patchTask, addTask, detailTask, detailLoading, patchDetailTask };
}
