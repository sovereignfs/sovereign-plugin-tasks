'use client';

import {
  Icon,
  MobileAppsDrawer,
  MobileFooter,
  Sheet,
  Spinner,
  SwipableMobileCarousel,
  SwipableMobileCarouselDots,
  SwipableMobileCarouselSlide,
  useCarouselRouteSync,
} from '@sovereignfs/ui';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import ListSidebar from '../ListSidebar';
import TasksPane from '../[listId]/TasksPane';
import { listDotColor } from '../_lib/colors';
import { useTasksData } from '../_lib/useTasksData';
import type { ListRow } from '../_lib/types';
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
  /** page.tsx's / search/page.tsx's real server-rendered output for the
   *  current route. Rendered directly (not just used as refreshSignal) for
   *  any route this carousel doesn't recognize as a real slide — currently
   *  just `/tasks/search` — so that page keeps working instead of silently
   *  showing whatever list `indexForPathname`'s own fallback lands on. See
   *  `isCarouselRoute`'s own doc comment. */
  children: ReactNode;
}

/**
 * True for any pathname `indexForPathname` below maps to a *real* slide —
 * bare `/tasks`, `/tasks/starred`, or `/tasks/<a current list's id>`. Used
 * to gate whether this carousel renders its own slides at all, or falls
 * back to rendering `children` (page.tsx's/search/page.tsx's real
 * server-rendered output) directly instead — mirrors
 * `DesktopTasksShell.tsx`'s own `activeListIdForPathname`, which this
 * carousel's own `indexForPathname` predates and didn't originally need,
 * since every route used to at least resolve to *some* slide.
 *
 * Without this, `/tasks/search` fell into `indexForPathname`'s "listId that
 * no longer exists" fallback (its captured segment, `"search"`, never
 * matches a real list id either) and silently showed the first list's
 * slide instead of the real search page — the URL changed
 * (`router.push('/tasks/search')` in this file's own footer Search icon)
 * but the carousel had no way to represent "not a list" as anything other
 * than "fall back to some list," so the visible content never changed.
 * `/tasks/search` is the only route in this bucket today, but the check is
 * written as a real allowlist (mirroring `activeListIdForPathname`'s own
 * choice) rather than special-casing that one path, so a future new
 * top-level route under `/tasks/*` that isn't a list/Starred fails safe
 * into the same `children` fallback instead of this same bug recurring.
 */
function isCarouselRoute(pathname: string, lists: ListRow[]): boolean {
  if (pathname === '/tasks' || pathname === '/tasks/starred') return true;
  const match = pathname.match(/^\/tasks\/([^/]+)$/);
  return !!match && lists.some((l) => l.id === match[1]);
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
  children,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const didSyncInitialUrl = useRef(false);
  const [appsOpen, setAppsOpen] = useState(false);

  // @sovereignfs/ui's Sheet/Drawer both size themselves against
  // --sv-shell-footer-height so their panels stop above the footer instead
  // of sliding underneath it (Sheet: `bottom: var(--sv-shell-footer-height,
  // 0)`; Drawer's scrim: same). That variable is set by the *platform*
  // shell for its own MobileNav — but this plugin declares
  // `shellConfig.mobileFooter: false` and renders its own MobileFooter
  // below instead, which the platform has no way to know about, so the
  // variable is never set here and both fall back to 0: their panels
  // extend all the way to the real viewport bottom and end up rendered
  // *underneath* this footer (z-index 101 vs. the overlay's 100) — the
  // footer visibly covers their last ~60px. Reported live as "Drawer has
  // broken" (its bottom row of labels cut off) and "task edit screen
  // content not scrollable" (the Delete button/List picker sat behind the
  // footer, unreachable — not actually a scroll bug). Measured rather than
  // hardcoded, since the footer's real height varies with
  // env(safe-area-inset-bottom) across devices. A first version used
  // ResizeObserver, which never fired even once in either the browser
  // preview or a real WebKit simulator session — switched to a direct
  // getBoundingClientRect() read in useLayoutEffect (plus a resize
  // listener for orientation changes / dynamic Safari toolbars) instead,
  // which is simpler and doesn't depend on ResizeObserver actually firing.
  const footerRef = useRef<HTMLDivElement>(null);
  const [footerHeight, setFooterHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = footerRef.current;
    if (!el) return;
    function measure() {
      if (el) setFooterHeight(el.getBoundingClientRect().height);
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

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

  // null when on the Lists index (0) or the Starred slide (1, its own cache
  // entry lives under STARRED_LIST_ID instead of a real ListRow).
  const activeList = activeIndex > 1 ? (lists[activeIndex - 2] ?? null) : null;
  const activeIsStarred = activeIndex === 1;
  // Whichever cache key (real list id or STARRED_LIST_ID) the current slide
  // reads from — unifies the two into one lookup for listState below.
  const activeListId = activeIsStarred ? STARRED_LIST_ID : (activeList?.id ?? null);
  const taskIdParam = searchParams.get('task');

  // Cache/staleness/persistence engine — shared with DesktopTasksShell, see
  // _lib/useTasksData.ts's own doc comment for why this was extracted
  // (findings doc Issue 2 / Part 2, desktop adoption).
  const { listState, patchTask, addTask, detailTask, detailLoading, patchDetailTask } =
    useTasksData({
      lists,
      activeListId,
      taskIdParam,
      refreshSignal,
    });

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
  const showCarousel = isCarouselRoute(pathname, lists);

  return (
    <div
      className={styles.wrap}
      style={
        footerHeight != null
          ? ({ '--sv-shell-footer-height': `${footerHeight}px` } as CSSProperties)
          : undefined
      }
    >
      <div className={styles.carouselArea}>
        {!showCarousel ? (
          children
        ) : (
          <SwipableMobileCarousel
            activeIndex={activeIndex}
            onSettle={onSettle}
            aria-label="Task lists"
            // No dots at all with zero real lists — a brand-new account only has
            // the Lists index + the (empty, meaningless at that point) Starred
            // slide, and showing a 2-dot indicator for that reads as more
            // navigable content than actually exists. Matches the old manual
            // dots' identical `lists.length > 0` gate. `density="compact"`
            // (RFC-less DS addition, packages/ui) halves the gap between dots —
            // an instance with more than a handful of lists otherwise reads as
            // a long, cramped row in a 375px viewport. See
            // docs/ux-improvement-plan.md Task 11 for the full investigation.
            renderIndicator={
              lists.length > 0
                ? (props) => (
                    <SwipableMobileCarouselDots
                      {...props}
                      aria-label="Task lists"
                      density="compact"
                    />
                  )
                : null
            }
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
        )}
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
      {/* MobileFooter itself isn't a forwardRef component, so the ref used
          to measure its real rendered height (see footerRef's own doc
          comment above) lives on this plain wrapper instead. */}
      <div ref={footerRef}>
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
      </div>

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
