'use client';

import {
  Icon,
  MobileAppsDrawer,
  MobileFooter,
  Sheet,
  Spinner,
  SwipableMobileCarousel,
  SwipableMobileCarouselSlide,
  useCarouselRouteSync,
} from '@sovereignfs/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import ListSidebar from '../ListSidebar';
import TasksPane from '../[listId]/TasksPane';
import { getOrCreatePrefs, getStarredTasks, getTask, getTasks } from '../_lib/actions';
import { listDotColor } from '../_lib/colors';
import type { ListRow, TaskRow } from '../_lib/types';
import { STARRED_LIST_ID } from '../_lib/virtualLists';
import TaskDetailPane, { type DetailTask } from './TaskDetailPane';
import type { FooterAppEntry } from './MobileAwareShell';
import styles from './MobileTasksCarousel.module.css';

/**
 * Stand-in for TasksPane's own header while a slide's tasks are still
 * loading — keeps the list name on screen immediately (from `lists`, already
 * known synchronously, no fetch needed) instead of the whole slide going
 * blank behind a centered "Loading…" placeholder. Deliberately a plain,
 * non-interactive echo of TasksPane's real title row (dot/star + title only,
 * no count/filter/menu — none of that is known yet) rather than mounting
 * TasksPane itself with an empty task array, which would flash a real "0
 * tasks"/empty-state body before the actual data replaces it. Swapped out
 * for TasksPane's own header the moment loading finishes — this only ever
 * exists for that brief window. */
function SlideHeaderSkeleton({
  title,
  color,
  starred,
}: {
  title: string;
  color: string | null;
  /** Mirrors TasksPane's own virtualList check — a real list can itself have
   *  a null color (pre-existing rows saved before color became mandatory,
   *  see colors.ts), so this needs its own explicit flag rather than
   *  overloading `color === null` to also mean "this is the Starred slide". */
  starred: boolean;
}) {
  return (
    <div className={styles.slideHeader}>
      <div className={styles.slideHeaderTitleRow}>
        {starred ? (
          <span className={styles.slideHeaderStarredIcon} aria-hidden>
            ★
          </span>
        ) : (
          <span
            className={styles.slideHeaderDot}
            style={{ background: listDotColor(color) }}
            aria-hidden
          />
        )}
        <h1 className={styles.slideHeaderTitle}>{title}</h1>
      </div>
      <div className={styles.slideHeaderBody}>
        <Spinner size="md" label={`Loading ${title}…`} />
      </div>
    </div>
  );
}

function monogram(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const [first = '', second = ''] = trimmed.split(/\s+/);
  return (second ? first.charAt(0) + second.charAt(0) : first.slice(0, 2)).toUpperCase();
}

interface ListState {
  tasks: TaskRow[];
  showCompleted: boolean;
  status: 'loading' | 'loaded' | 'error';
}

interface Props {
  lists: ListRow[];
  /** Count of active starred tasks — see ListSidebar's own doc comment. */
  starredCount: number;
  /** Every other launchable plugin, for the self-rendered Apps drawer below
   *  — see this component's own doc comment on the footer for why. */
  footerApps: FooterAppEntry[];
  /** The Launcher's own icon, for the footer's center Apps button — see
   *  MobileAwareShell's doc comment on this same prop. */
  launcherIconUrl?: string;
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

export default function MobileTasksCarousel({
  lists,
  starredCount,
  footerApps,
  launcherIconUrl,
  refreshSignal,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const didSyncInitialUrl = useRef(false);
  const isFirstRefreshSignal = useRef(true);
  const [appsOpen, setAppsOpen] = useState(false);

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
  // Tracks listIds with a fetch currently in flight — a ref, not state, so a
  // second loadList(id) call that lands before the first resolves can see it
  // synchronously and no-op instead of firing a duplicate set of server
  // actions. Needed because the callers' own guards (the prefetch effect's
  // `if (!listState[id])`, below) read listState from a render closure that
  // React's dev-mode Strict Mode double-invoke — or a fast swipe past the
  // same neighbor twice before its first load settles — can race past.
  const loadingIdsRef = useRef<Set<string>>(new Set());

  // null when on the Lists index (0) or the Starred slide (1, its own cache
  // entry lives under STARRED_LIST_ID instead of a real ListRow).
  const activeList = activeIndex > 1 ? (lists[activeIndex - 2] ?? null) : null;
  const activeIsStarred = activeIndex === 1;
  // Whichever cache key (real list id or STARRED_LIST_ID) the current slide
  // reads from — unifies the two into one lookup for listState below.
  const activeListId = activeIsStarred ? STARRED_LIST_ID : (activeList?.id ?? null);
  const taskIdParam = searchParams.get('task');

  const loadList = useCallback(async (listId: string) => {
    if (loadingIdsRef.current.has(listId)) return;
    loadingIdsRef.current.add(listId);
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
    } finally {
      loadingIdsRef.current.delete(listId);
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

  // Mirrors patchTask above, for the add-task path — see TasksPane's
  // onTaskAdded doc comment for why this is needed (without it, a task added
  // on mobile appears to do nothing until loadList's own refetch catches up).
  const addTask = useCallback((taskListId: string, task: TaskRow) => {
    setListState((s) => {
      const entry = s[taskListId];
      if (!entry) return s;
      return { ...s, [taskListId]: { ...entry, tasks: [...entry.tasks, task] } };
    });
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
      <div className={styles.carouselArea}>
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
              <SlideHeaderSkeleton title="Starred" color={null} starred />
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
                    onTaskAdded={(task) => addTask(list.id, task)}
                  />
                ) : (
                  <SlideHeaderSkeleton title={list.title} color={list.color} starred={false} />
                )}
              </SwipableMobileCarouselSlide>
            );
          })}
        </SwipableMobileCarousel>
      </div>

      {/* Self-rendered mobile footer (manifest shellConfig.mobileFooter:
          false — the platform's own footer is off for this plugin). Left
          icon jumps straight to the Lists slide via onSettle(0), the same
          "external navigation" path a dot-indicator jump uses — not a
          navigation to bare /tasks, which already has its own, different
          meaning (cold-load → first list, see indexForPathname above).
          Center Apps button and right Search icon mirror the platform
          shell's own MobileNav convention, just plugin-local: the apps list
          comes from layout.tsx's sdk.plugins.list() call (this component
          can't call it itself — that SDK method needs next/headers), and
          Search routes to this plugin's own /tasks/search rather than the
          platform's instance-wide search overlay, which isn't exposed to
          plugins. The center button uses the Launcher's own icon (same as
          the platform shell's MobileNav) rather than the generic default,
          so the two footers read as identical, not just similar. */}
      <MobileFooter
        onOpenApps={() => setAppsOpen(true)}
        launcherOpen={appsOpen}
        launcherIcon={
          launcherIconUrl ? (
            <img src={launcherIconUrl} alt="" aria-hidden className={styles.launcherIcon} />
          ) : undefined
        }
        leftIcons={[
          {
            icon: <Icon name="menu" size="md" aria-hidden />,
            label: 'Lists',
            active: activeIndex === 0,
            onClick: () => onSettle(0),
          },
        ]}
        rightIcons={[
          {
            icon: <Icon name="search" size="md" aria-hidden />,
            label: 'Search',
            active: pathname === '/tasks/search',
            onClick: () => router.push('/tasks/search'),
          },
        ]}
      />

      <MobileAppsDrawer
        open={appsOpen}
        onClose={() => setAppsOpen(false)}
        aria-label="Apps"
        items={footerApps.map((app) => ({
          key: app.id,
          icon: app.iconUrl ? (
            <img src={app.iconUrl} alt="" className={styles.appIcon} />
          ) : (
            monogram(app.name)
          ),
          label: app.name,
          onClick: () => {
            setAppsOpen(false);
            router.push(app.routePrefix);
          },
        }))}
      />

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
