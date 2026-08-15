'use client';

import {
  Sheet,
  SwipableMobileCarousel,
  SwipableMobileCarouselSlide,
  useCarouselRouteSync,
} from '@sovereignfs/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import ListSidebar from '../ListSidebar';
import TasksPane from '../[listId]/TasksPane';
import { getOrCreatePrefs, getStarredTasks, getTask, getTasks } from '../_lib/actions';
import type { ListRow, TaskRow } from '../_lib/types';
import { STARRED_LIST_ID } from '../_lib/virtualLists';
import TaskDetailPane, { type DetailTask } from './TaskDetailPane';
import styles from './MobileTasksCarousel.module.css';

interface ListState {
  tasks: TaskRow[];
  showCompleted: boolean;
  status: 'loading' | 'loaded' | 'error';
}

interface Props {
  lists: ListRow[];
  /** Count of active starred tasks — see ListSidebar's own doc comment. */
  starredCount: number;
  /** Changes identity on every server re-render of the plugin's routes (i.e.
   *  whenever anything anywhere calls router.refresh()). This carousel's own
   *  data lives in client state, decoupled from page.tsx's server props (see
   *  MobileAwareShell's doc comment for why) — this is purely a signal to
   *  re-fetch the active slide, piggy-backing on the refresh calls already
   *  scattered through TasksPane/TaskDetailPane/etc. without touching them. */
  refreshSignal: unknown;
}

/** Slide index 0 is the Lists index, index 1 is the virtual Starred view
 *  (TSK-28), index n (n>=2) is lists[n-2]. */
function indexForPathname(pathname: string, lists: ListRow[]): number {
  if (pathname === '/tasks/starred') return 1;
  const match = pathname.match(/^\/tasks\/([^/]+)/);
  if (match) {
    const idx = lists.findIndex((l) => l.id === match[1]);
    if (idx !== -1) return idx + 2;
  }
  // Bare /tasks, or a listId that no longer exists — land on the user's first
  // list rather than the index slide (matches the desktop sidebar + first
  // list being visible together; there's no "first list" concept to preserve
  // on desktop since both are already on screen at once).
  return lists.length > 0 ? 2 : 0;
}

/** Inverse of indexForPathname — the path to navigate to once a swipe
 *  settles on a given slide index. Falls back to the bare /tasks index route
 *  if the index no longer has a matching list (e.g. the active list was just
 *  deleted out from under an in-flight settle). */
function pathForIndex(index: number, lists: ListRow[]): string {
  if (index === 0) return '/tasks';
  if (index === 1) return '/tasks/starred';
  const list = lists[index - 2];
  return list ? `/tasks/${list.id}` : '/tasks';
}

export default function MobileTasksCarousel({ lists, starredCount, refreshSignal }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const didSyncInitialUrl = useRef(false);
  const isFirstRefreshSignal = useRef(true);

  // Centralizes the pathname↔slide-index mapping and the "was this pathname
  // change our own settle, or an external navigation" distinction that used
  // to be hand-rolled here (isInternalNav/didMountPathSync) — see
  // useCarouselRouteSync's own doc comment. indexForPathname/pathForIndex
  // read `lists` via closure; identity doesn't matter since the hook stores
  // them in refs.
  const { activeIndex, onSettle } = useCarouselRouteSync({
    indexForPathname: (path) => indexForPathname(path, lists),
    pathForIndex: (index) => pathForIndex(index, lists),
    pathname,
    onNavigate: (path) => router.replace(path, { scroll: false }),
  });

  const [listState, setListState] = useState<Record<string, ListState>>({});
  const [detailTask, setDetailTask] = useState<DetailTask | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // null when on the Lists index (0) or the Starred slide (1, its own cache
  // entry lives under STARRED_LIST_ID instead of a real ListRow).
  const activeList = activeIndex > 1 ? (lists[activeIndex - 2] ?? null) : null;
  const activeIsStarred = activeIndex === 1;
  // Whichever cache key (real list id or STARRED_LIST_ID) the current slide
  // reads from — unifies the two into one lookup for listState below.
  const activeListId = activeIsStarred ? STARRED_LIST_ID : (activeList?.id ?? null);
  const taskIdParam = searchParams.get('task');

  const loadList = useCallback(async (listId: string) => {
    setListState((s) => {
      const existing = s[listId];
      // A background refresh (e.g. router.refresh() after toggling a
      // checkbox re-fires this for the active slide via the refreshSignal
      // effect below) should keep showing the already-loaded tasks while
      // the refetch happens, not flip back to the "Loading…" placeholder —
      // that unmounts and remounts TasksPane, which was the source of a
      // visible flicker on every mutation, and (combined with the cold-load
      // effect's router.replace also re-firing this for the same list right
      // after the initial mount fetch) a double flicker on first open.
      // 'loading' is reserved for a list's genuine first-ever fetch.
      const status = existing?.status === 'loaded' ? 'loaded' : 'loading';
      return {
        ...s,
        [listId]: {
          tasks: existing?.tasks ?? [],
          showCompleted: existing?.showCompleted ?? false,
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
        setListState((s) => ({
          ...s,
          [listId]: { tasks, showCompleted: false, status: 'loaded' },
        }));
        return;
      }
      const [tasks, prefs] = await Promise.all([getTasks(listId), getOrCreatePrefs(listId)]);
      setListState((s) => ({
        ...s,
        [listId]: { tasks, showCompleted: prefs?.showCompleted ?? false, status: 'loaded' },
      }));
    } catch {
      setListState((s) => ({
        ...s,
        [listId]: { tasks: [], showCompleted: false, status: 'error' },
      }));
    }
  }, []);

  // Synchronously patches this carousel's own decoupled task caches the
  // moment an optimistic toggle (completion, star) fires inside a slide —
  // see StarButton's onOptimisticChange doc comment for why. Without this,
  // listState/detailTask stay stale until loadList's/the detailTask effect's
  // own refetch (triggered by refreshSignal, some time after this same
  // toggle's transition has already settled) eventually catches up, causing
  // a visible revert-then-reapply flicker back to the old value.
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

  // Fetch the active slide plus its immediate neighbors — a single swipe
  // never shows a loading spinner since the destination is already cached.
  useEffect(() => {
    const neighborIds = [activeIndex - 1, activeIndex, activeIndex + 1]
      .map((i) => (i === 1 ? STARRED_LIST_ID : lists[i - 2]?.id))
      .filter((id): id is string => !!id);
    for (const id of neighborIds) {
      if (!listState[id]) loadList(id);
    }
    // listState intentionally excluded from deps — it's the effect's own
    // output (loadList's setListState calls), not an input that should retrigger it.
  }, [activeIndex, lists, loadList]);

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
    // real list. Its cache lives independently of whichever slide is active
    // (see listState's per-list-id shape above), so a star toggle elsewhere
    // never touched it before this line: revisiting Starred later replayed
    // whatever snapshot was cached the last time it happened to be the
    // active/neighboring slide, silently missing anything starred since.
    // Only refetch it if it's already been loaded once — matches the rest of
    // this file's "never eagerly fetch a slide nobody has viewed" approach.
    if (activeListId !== STARRED_LIST_ID && listState[STARRED_LIST_ID]) {
      loadList(STARRED_LIST_ID);
    }
    // Intentionally only keyed on refreshSignal — activeListId/loadList/
    // listState are read at fire-time, not triggers for re-running this
    // effect themselves.
  }, [refreshSignal]);

  // Cold-load at the bare /tasks route: sync the URL to the first list once,
  // so a refresh/share-link lands consistently with what's on screen.
  useEffect(() => {
    if (didSyncInitialUrl.current) return;
    didSyncInitialUrl.current = true;
    const first = lists[0];
    if (pathname === '/tasks' && first) {
      router.replace(`/tasks/${first.id}`, { scroll: false });
    }
  }, [pathname, lists, router]);

  // Task detail sheet: driven by the ?task= param, same convention as desktop.
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

  function closeDetail() {
    const params = new URLSearchParams(searchParams);
    params.delete('task');
    const qs = params.toString();
    router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
  }

  // Guard against a stale ?task from a different list, same as page.tsx does.
  // On the Starred slide there's no single "current list" to match against —
  // it aggregates every list by design — so any detailTask is accepted there.
  const validDetailTask =
    detailTask && (activeIsStarred || detailTask.listId === activeList?.id) ? detailTask : null;

  // While getTask() above is in flight, the tapped task's summary fields are
  // already sitting in this same list's cached tasks (whatever TaskItem the
  // user just tapped rendered from) — everything DetailTask needs except
  // seriesId, which useEditScope only reads at the moment of a later commit
  // (not captured once at mount), so a temporary null there is harmless.
  // Rendering this immediately instead of a bare "Loading…" placeholder is
  // what removes the layout jump right after the overlay opens — the content
  // is full-sized from the first frame, and swapping in the authoritative
  // fetch afterwards is an invisible, same-shape update, not a remount
  // (TaskDetailPane's inner DetailBody is keyed by task.id, which doesn't
  // change between the optimistic and authoritative versions).
  const optimisticDetailTask: DetailTask | null =
    !validDetailTask && taskIdParam && activeListId
      ? (() => {
          const t = listState[activeListId]?.tasks.find((task) => task.id === taskIdParam);
          return t ? { ...t, seriesId: null } : null;
        })()
      : null;
  const displayDetailTask = validDetailTask ?? optimisticDetailTask;
  const showDetailOverlay = !!taskIdParam && (detailLoading || displayDetailTask !== null);

  const starredState = listState[STARRED_LIST_ID];

  return (
    <div className={styles.wrap}>
      <SwipableMobileCarousel
        activeIndex={activeIndex}
        onSettle={onSettle}
        aria-label="Task lists"
        // No dots at all with zero real lists — a brand-new account only has
        // the Lists index + the (empty, meaningless at that point) Starred
        // slide, and showing a 2-dot indicator for that reads as more
        // navigable content than actually exists. Matches the old manual
        // dots' identical `lists.length > 0` gate.
        renderIndicator={lists.length > 0 ? undefined : null}
      >
        <SwipableMobileCarouselSlide slideKey="index" label="Lists">
          <ListSidebar lists={lists} starredCount={starredCount} />
        </SwipableMobileCarouselSlide>

        <SwipableMobileCarouselSlide slideKey={STARRED_LIST_ID} label="Starred">
          {starredState && starredState.status !== 'loading' ? (
            <TasksPane
              list={{ id: STARRED_LIST_ID, title: 'Starred', color: null, openCount: 0 }}
              lists={lists}
              initialTasks={starredState.tasks}
              showCompleted={false}
              listId={STARRED_LIST_ID}
              selectedTaskId={displayDetailTask?.id ?? null}
              onTaskFieldPatch={(taskId, patch) => patchTask(STARRED_LIST_ID, taskId, patch)}
              virtualList="starred"
            />
          ) : (
            <div className={styles.slideLoading}>Loading…</div>
          )}
        </SwipableMobileCarouselSlide>

        {lists.map((list) => {
          const state = listState[list.id];
          return (
            <SwipableMobileCarouselSlide key={list.id} slideKey={list.id} label={list.title}>
              {state && state.status !== 'loading' ? (
                <TasksPane
                  list={list}
                  lists={lists}
                  initialTasks={state.tasks}
                  showCompleted={state.showCompleted}
                  listId={list.id}
                  selectedTaskId={displayDetailTask?.id ?? null}
                  onTaskFieldPatch={(taskId, patch) => patchTask(list.id, taskId, patch)}
                />
              ) : (
                <div className={styles.slideLoading}>Loading…</div>
              )}
            </SwipableMobileCarouselSlide>
          );
        })}
      </SwipableMobileCarousel>

      <Sheet open={showDetailOverlay} onClose={closeDetail} aria-label="Task details">
        {displayDetailTask && activeListId ? (
          <TaskDetailPane
            task={displayDetailTask}
            listId={activeListId}
            lists={lists}
            onFieldPatch={patchDetailTask}
          />
        ) : (
          <div className={styles.slideLoading}>Loading…</div>
        )}
      </Sheet>
    </div>
  );
}
