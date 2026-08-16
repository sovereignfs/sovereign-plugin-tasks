'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DetailTask } from '../_components/TaskDetailPane';
import { getOrCreatePrefs, getStarredTasks, getTask, getTasks } from './actions';
import { persistList, readPersistedList, STALE_AFTER_MS } from './listCache';
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
 * One deliberate simplification versus the original mobile-only version:
 * the old prefetch effect fetched `[activeIndex-1, activeIndex,
 * activeIndex+1]` first (carousel-adjacency priority) before background-
 * warming everything else. A generic hook has no concept of carousel
 * adjacency, so this instead prioritizes just `activeListId` first, then
 * every other list concurrently — the functional behavior (every list ends
 * up cached, the active one first) is unchanged; only the neighbor-specific
 * request-ordering nicety is gone, which has no user-visible effect since
 * everything still fires within the same effect tick regardless.
 */

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

  const loadList = useCallback(async (listId: string) => {
    if (loadingIdsRef.current.has(listId)) return;
    loadingIdsRef.current.add(listId);

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
    try {
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

  // Fetch the active list first, then background-warm every other
  // not-yet-cached list (findings doc Issue 2's actual fix — a fast,
  // continuous swipe/navigation past several never-visited lists in a row
  // used to outrun a neighbor-only prefetch window). Also revalidates the
  // active entry if it's gone stale since it was last fetched
  // (revalidate-on-focus, trigger 1: becoming active again).
  useEffect(() => {
    if (activeListId && !listState[activeListId]) loadList(activeListId);

    if (activeListId) {
      const entry = listState[activeListId];
      if (entry?.status === 'loaded' && Date.now() - entry.fetchedAt > STALE_AFTER_MS) {
        loadList(activeListId);
      }
    }

    const allIds = [STARRED_LIST_ID, ...lists.map((l) => l.id)];
    for (const id of allIds) {
      if (id !== activeListId && !listState[id]) loadList(id);
    }
    // listState intentionally excluded from deps — it's the effect's own
    // output (loadList's setListState calls), not an input that should retrigger it.
  }, [activeListId, lists, loadList]);

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
