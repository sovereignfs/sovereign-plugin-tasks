'use client';

import { Spinner } from '@sovereignfs/ui';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import ListSidebar from '../ListSidebar';
import TasksPane from '../[listId]/TasksPane';
import { useTasksData } from '../_lib/useTasksData';
import type { ListRow } from '../_lib/types';
import { STARRED_LIST_ID } from '../_lib/virtualLists';
import TaskDetailPane, { type DetailTask } from './TaskDetailPane';
import layoutStyles from '../layout.module.css';
import pageStyles from '../[listId]/page.module.css';

interface Props {
  lists: ListRow[];
  /** Count of active starred tasks — see ListSidebar's own doc comment. */
  starredCount: number;
  /** Changes identity on every server re-render of the plugin's routes —
   *  see MobileTasksCarousel's own doc comment on this same prop. This
   *  shell's own list/detail data lives in client state (useTasksData),
   *  decoupled from page.tsx's server props, for exactly the same reason:
   *  instant re-navigation between already-visited lists instead of a full
   *  RSC round trip every time. */
  refreshSignal: unknown;
  /** page.tsx's / starred/page.tsx's / search/page.tsx's real server-rendered
   *  output for the current route. Rendered directly (not just used as
   *  refreshSignal) for any route this shell doesn't recognize as a
   *  cache-covered list/Starred route — bare `/tasks`, `/tasks/search`, and
   *  anything else — so those keep working exactly as before this shell
   *  existed. See activeListIdForPathname's own doc comment for why this is
   *  an *exact* match rather than mobile's looser prefix match. */
  children: ReactNode;
}

/**
 * Resolves the current pathname to a cache key (findings doc Issue 2 / Part
 * 2 — desktop adoption), or `null` for anything this shell doesn't cover.
 * Deliberately an *exact* single-segment match against a real, current list
 * id — not mobile's `indexForPathname`, which prefix-matches
 * `/^\/tasks\/([^/]+)/` and falls back to "show the first list" for
 * anything that doesn't resolve (bare /tasks *or* an unrecognized segment
 * like /tasks/search). That fallback is fine for mobile, which always
 * renders the carousel regardless of route and has no other way to render
 * /tasks/search at all today (a separate, pre-existing gap, not something
 * this shell should copy) — but desktop already has a real, working
 * /tasks/search page via `children`. Returning `null` here for anything
 * that isn't a real list/Starred route is what makes the `children`
 * fallback below actually reachable, so desktop's existing non-list routes
 * keep working unchanged.
 */
function activeListIdForPathname(pathname: string, lists: ListRow[]): string | null {
  if (pathname === '/tasks/starred') return STARRED_LIST_ID;
  const id = pathname.match(/^\/tasks\/([^/]+)$/)?.[1];
  return id && lists.some((l) => l.id === id) ? id : null;
}

/** Minimal desktop equivalent of MobileTasksCarousel's SlideHeaderSkeleton —
 *  simpler because desktop has no slide-swap animation to keep visually
 *  continuous through; a centered spinner in the list column is enough to
 *  avoid a blank flash while a never-before-cached list's first fetch is in
 *  flight (persisted-cache hydration already covers the common case of a
 *  previously-visited list). */
function ListColumnLoading() {
  return (
    <div
      className={pageStyles.listCol}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Spinner size="md" label="Loading…" />
    </div>
  );
}

export default function DesktopTasksShell({ lists, starredCount, refreshSignal, children }: Props) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeListId = activeListIdForPathname(pathname, lists);
  const activeIsStarred = activeListId === STARRED_LIST_ID;
  const taskIdParam = searchParams.get('task');

  // Cache/staleness/persistence engine — shared with MobileTasksCarousel,
  // see _lib/useTasksData.ts's own doc comment.
  const { listState, patchTask, addTask, detailTask, detailLoading, patchDetailTask } =
    useTasksData({
      lists,
      activeListId,
      taskIdParam,
      refreshSignal,
    });

  // No explicit "close detail" affordance on desktop, unlike mobile's Sheet
  // (a modal overlay that needs a dismiss handler) — TaskDetailPane already
  // renders its own "No task selected" empty state for `task: null`, and
  // deselecting happens by clicking a different task (a plain Link changing
  // ?task=), not a callback this shell needs to provide.

  // Guard against a stale ?task from a different list, matching page.tsx's
  // own equivalent guard exactly. On Starred there's no single "current
  // list" to match against — it aggregates every list by design.
  const validDetailTask =
    detailTask && (activeIsStarred || detailTask.listId === activeListId) ? detailTask : null;

  // Same optimistic-detail-from-cache trick as MobileTasksCarousel — see its
  // own doc comment on optimisticDetailTask for the full reasoning.
  const optimisticDetailTask: DetailTask | null =
    !validDetailTask && taskIdParam && activeListId
      ? (() => {
          const t = listState[activeListId]?.tasks.find((task) => task.id === taskIdParam);
          return t ? { ...t, seriesId: null } : null;
        })()
      : null;
  const displayDetailTask = validDetailTask ?? optimisticDetailTask;

  const activeState = activeListId ? listState[activeListId] : undefined;
  const activeRealList = activeListId ? (lists.find((l) => l.id === activeListId) ?? null) : null;

  return (
    <div className={layoutStyles.shell} data-plugin-fullbleed>
      <aside className={layoutStyles.sidebar}>
        <ListSidebar lists={lists} starredCount={starredCount} />
      </aside>
      {activeListId ? (
        <div className={pageStyles.inner}>
          {activeState && activeState.status !== 'loading' ? (
            <div className={pageStyles.listCol}>
              <TasksPane
                list={
                  activeIsStarred
                    ? {
                        id: STARRED_LIST_ID,
                        title: 'Starred',
                        color: null,
                        // Unlike MobileTasksCarousel's own hardcoded 0 for this
                        // same synthetic ListRow (the mobile carousel's
                        // slide-index dots don't read it, so that was never
                        // noticed), desktop's own pre-existing
                        // starred/page.tsx computed this for real — matching
                        // that rather than the mobile shortcut, since nothing
                        // stops this shell from doing so too.
                        openCount: activeState.tasks.filter((t) => t.completedAt === null).length,
                      }
                    : (activeRealList ?? { id: activeListId, title: '', color: null, openCount: 0 })
                }
                lists={lists}
                initialTasks={activeState.tasks}
                showCompleted={activeState.showCompleted}
                listId={activeListId}
                selectedTaskId={displayDetailTask?.id ?? null}
                onTaskFieldPatch={(taskId, patch) => patchTask(activeListId, taskId, patch)}
                onTaskAdded={activeIsStarred ? undefined : (task) => addTask(activeListId, task)}
                virtualList={activeIsStarred ? 'starred' : undefined}
              />
            </div>
          ) : (
            <ListColumnLoading />
          )}
          <aside className={pageStyles.detailCol}>
            {/* A task's summary fields (used for optimisticDetailTask) come
                from this same list's already-cached rows — so this loading
                state is only ever reachable when the tapped task isn't in
                the cache either (e.g. a task from a list this shell never
                loaded, reached via a direct link with ?task= already set). */}
            {taskIdParam && !displayDetailTask && detailLoading ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                }}
              >
                <Spinner size="md" label="Loading…" />
              </div>
            ) : (
              <TaskDetailPane
                task={displayDetailTask}
                listId={activeListId}
                lists={lists}
                onFieldPatch={patchDetailTask}
              />
            )}
          </aside>
        </div>
      ) : (
        <main className={layoutStyles.content}>{children}</main>
      )}
    </div>
  );
}
