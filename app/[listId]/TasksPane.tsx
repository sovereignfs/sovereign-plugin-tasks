'use client';

import { DndContext, closestCenter } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import {
  ConfirmDialog,
  Icon,
  Menu,
  type MenuEntry,
  SegmentedControl,
  useCommitOnEnterOrBlur,
} from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import BulkActionBar from '../_components/BulkActionBar';
import TaskItem from '../_components/TaskItem';
import {
  bulkDeleteTasks,
  bulkMoveTasks,
  createTask,
  deleteList,
  reorderTasks,
  toggleComplete,
  updateList,
  updatePrefs,
} from '../_lib/actions';
import { isOverdue } from '../_lib/date';
import { listDotColor } from '../_lib/colors';
import { useReorderSensors } from '../_lib/dndSensors';
import { measureTextWidth } from '../_lib/measureText';
import { SORT_OPTIONS, pinDueTodayAndOverdue, sortTasks, type SortBy } from '../_lib/sort';
import { useIsMobile } from '../_lib/useIsMobile';
import type { ListRow, TaskRow } from '../_lib/types';
import styles from './TasksPane.module.css';

type Filter = 'all' | 'active' | 'overdue';

/** initialTasks' actual shape — plain TaskRow for a real list, decorated with
 *  the source list's title/colour when virtualList (TSK-28's Starred view;
 *  see getStarredTasks). Optional fields keep both shapes assignable. */
type TaskWithListMeta = TaskRow & { listTitle?: string; listColor?: string | null };

interface Props {
  list: ListRow;
  lists: ListRow[];
  initialTasks: TaskWithListMeta[];
  showCompleted: boolean;
  listId: string;
  selectedTaskId: string | null;
  /**
   * Called synchronously with a partial update the moment an optimistic
   * toggle (completion, star) fires on a row here — see StarButton's
   * onOptimisticChange doc comment for why. Only provided by
   * MobileTasksCarousel (which keeps its own decoupled task cache); absent
   * on desktop's page.tsx, where router.refresh() already re-renders this
   * pane with fresh server props within the same transition.
   */
  onTaskFieldPatch?: (taskId: string, patch: Partial<TaskRow>) => void;
  /**
   * Called synchronously with the optimistic task the moment handleAddTask
   * fires — same reason and same pattern as onTaskFieldPatch above (see its
   * doc comment). Without this, a task added on mobile appears to do
   * nothing: this component's own useOptimistic overlay is discarded the
   * moment the enclosing transition (createTask + router.refresh()) settles,
   * which happens before MobileTasksCarousel's own decoupled refetch
   * (triggered by that same router.refresh(), but asynchronous) delivers a
   * fresh initialTasks prop containing the new task — a gap of one round
   * trip where neither the optimistic value nor the real one includes it.
   * Only provided by MobileTasksCarousel; absent on desktop's page.tsx, same
   * as onTaskFieldPatch.
   */
  onTaskAdded?: (task: TaskRow) => void;
  /**
   * Renders the virtual "Starred" view (TSK-28) instead of a real list:
   * header/menu strip to Sort by only (no rename/colour/delete-list/
   * delete-completed), no add-task row, drag-reorder always off (no manual
   * order across lists — Sort excludes Manual, defaults to Due date), rows
   * show a source-list badge, detail links stay in `/tasks/starred?task=…`,
   * and bulk select is unavailable (bulkDeleteTasks/bulkMoveTasks are scoped
   * to a single owning list, which a cross-list aggregation doesn't have).
   */
  virtualList?: 'starred';
}

// Elements that should swallow single-letter shortcuts because the user is
// typing into them (TSK-19 — shortcuts only fire when focus isn't in a field).
const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

type TaskAction = { type: 'add'; task: TaskWithListMeta } | { type: 'reorder'; ids: string[] };

function tasksReducer(state: TaskWithListMeta[], action: TaskAction): TaskWithListMeta[] {
  switch (action.type) {
    case 'add':
      return [...state, action.task];
    case 'reorder': {
      const byId = new Map(state.map((t) => [t.id, t]));
      return action.ids.map((id) => byId.get(id)).filter((t): t is TaskRow => t !== undefined);
    }
  }
}

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'overdue', label: 'Overdue' },
];

export default function TasksPane({
  list,
  lists,
  initialTasks,
  showCompleted: initialShowCompleted,
  listId,
  selectedTaskId,
  onTaskFieldPatch,
  onTaskAdded,
  virtualList,
}: Props) {
  const router = useRouter();
  const isMobile = useIsMobile();
  const [newTitle, setNewTitle] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [_isPending, startTransition] = useTransition();
  const addInputRef = useRef<HTMLInputElement>(null);

  // Rename-via-double-click on the title stays desktop only — there's no
  // touch equivalent of a double-click, so mobile keeps renaming through
  // ListSidebar's own actions Drawer on the Lists index slide instead (see
  // CLAUDE.md's "Mobile shell" section). The header options menu (Filter
  // when folded, Sort by, Delete list) below is shared with mobile — same
  // responsive inline-vs-menu logic on both, since mobile screens are just a
  // narrower case of the same "does Filter fit next to the title" question.
  const [renaming, setRenaming] = useState(false);
  const [renameTitle, setRenameTitle] = useState(list.title);
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Pixel-accurate width for the rename input (see _lib/measureText) — a
  // `ch`-unit estimate looked visibly too wide for this font/weight and
  // space-heavy titles. Re-measured on every keystroke against the input's
  // own computed font, so it grows/shrinks live instead of jumping once on
  // entering edit mode.
  const [renameInputWidth, setRenameInputWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!renaming) return;
    const el = renameInputRef.current;
    if (!el) return;
    const width = measureTextWidth(renameTitle || ' ', el);
    if (width !== null) setRenameInputWidth(width + 4);
  }, [renaming, renameTitle]);
  const [menuOpen, setMenuOpen] = useState(false);
  // The virtual Starred view has no cross-list manual order to fall back on —
  // Manual is excluded from its Sort options (see sortOptions below) and Due
  // date is the more useful default there.
  const [sortBy, setSortBy] = useState<SortBy>(virtualList ? 'dueDate' : 'manual');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteCompletedOpen, setDeleteCompletedOpen] = useState(false);
  const sortOptions = virtualList ? SORT_OPTIONS.filter((o) => o.value !== 'manual') : SORT_OPTIONS;

  // Whether Filter fits inline in the title row (next to the options menu)
  // instead of folding into that menu. Measured against a hidden "shadow"
  // copy of the fully-inline row (same markup/classes, position: absolute +
  // visibility: hidden so it never affects real layout or a11y) rather than
  // manually summing up dot/title/count/filter/menu widths plus gaps by
  // hand — the shadow row lets the browser's own layout do that arithmetic,
  // so it stays correct even if gaps/padding change later. Defaults to false
  // (menu-only) for SSR/first paint, matching useIsMobile's own safe-default
  // pattern, then corrected once the client can actually measure. The effect
  // itself is below, after `active` (one of its dependencies) is computed.
  const [filterFitsInline, setFilterFitsInline] = useState(false);
  const titleRowRef = useRef<HTMLDivElement>(null);
  const shadowRowRef = useRef<HTMLDivElement>(null);

  const [tasks, applyTaskAction] = useOptimistic(initialTasks, tasksReducer);
  const [completedOpen, setCompletedOpen] = useOptimistic(
    initialShowCompleted,
    (_prev, next: boolean) => next,
  );

  // TSK-19 — keyboard row focus (j/k/Up/Down), independent of `selectedTaskId`
  // (the task open in the detail pane).
  const [focusedId, setFocusedId] = useState<string | null>(null);
  // TSK-20/21 — bulk selection (ctrl/cmd-click or long-press on a row).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Mobile swipe-to-reveal (Done/Delete) — a single id (not a Set) means
  // opening one row's reveal via a prop-driven re-render automatically slides
  // any previously-open row shut, same pattern as ListSidebar's swipeOpenId.
  const [swipeOpenTaskId, setSwipeOpenTaskId] = useState<string | null>(null);

  // MouseSensor (handle-initiated, desktop) + TouchSensor (long-press lift,
  // mobile) + KeyboardSensor — see app/_lib/dndSensors.ts for the tuning
  // constants and the data-no-dnd exclusion mechanism.
  const sensors = useReorderSensors();

  const active = tasks.filter((t) => t.completedAt === null);

  useEffect(() => {
    const row = titleRowRef.current;
    const shadow = shadowRowRef.current;
    if (!row || !shadow) return;

    function recompute() {
      if (!row || !shadow) return;
      setFilterFitsInline(shadow.offsetWidth <= row.clientWidth);
    }

    recompute();
    const ro = new ResizeObserver(recompute);
    ro.observe(row);
    return () => ro.disconnect();
  }, [list.title, active.length]);

  const activeFiltered =
    filter === 'overdue' ? active.filter((t) => isOverdue(t.dueDate, t.completedAt)) : active;
  // 'all' shows every task — completed included — together in the main
  // list, in place, instead of splitting completed ones off into the
  // separate collapsible section below. Marking a task done while viewing
  // "All" should leave it exactly where it is, not move it anywhere.
  // pinDueTodayAndOverdue always runs last, on top of whatever sortBy already
  // did — "needs attention now" floats to the top regardless of sort mode or
  // filter, per its own doc comment.
  const activeVisible = pinDueTodayAndOverdue(
    sortTasks(filter === 'all' ? tasks : activeFiltered, sortBy),
  );
  const completed = sortTasks(
    tasks.filter((t) => t.completedAt !== null),
    sortBy,
  );
  // The separate section only makes sense for 'active' (where completed
  // tasks are otherwise hidden from the main list) — 'overdue' excludes
  // completed tasks by definition, and 'all' already shows them inline above.
  const showCompletedSection = filter === 'active' && completed.length > 0;
  const completedExpanded = filter === 'all' || completedOpen;

  useEffect(() => {
    if (renaming) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [renaming]);

  function refresh() {
    startTransition(() => router.refresh());
  }

  function startRename() {
    setRenameTitle(list.title);
    setRenaming(true);
  }

  function commitRename() {
    const trimmed = renameTitle.trim();
    setRenaming(false);
    if (trimmed && trimmed !== list.title) {
      startTransition(async () => {
        await updateList(listId, trimmed);
        router.refresh();
      });
    }
  }

  function cancelRename() {
    setRenameTitle(list.title);
    setRenaming(false);
  }

  function confirmDeleteList() {
    setDeleteOpen(false);
    startTransition(async () => {
      await deleteList(listId);
      router.push('/tasks');
      router.refresh();
    });
  }

  // Reuses bulkDeleteTasks (already tenant-scoped, cascades to subtasks) —
  // completed already holds every completed task in this list regardless of
  // the current filter, so no separate server action is needed just to
  // scope "delete completed" down to one list.
  function confirmDeleteCompleted() {
    setDeleteCompletedOpen(false);
    const ids = completed.map((t) => t.id);
    startTransition(async () => {
      await bulkDeleteTasks(ids, listId);
      router.refresh();
    });
  }

  function toggleBulkSelect(taskId: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }

  function clearBulkSelect() {
    setSelectedIds(new Set());
  }

  function handleBulkDelete() {
    const ids = [...selectedIds];
    clearBulkSelect();
    startTransition(async () => {
      await bulkDeleteTasks(ids, listId);
      router.refresh();
    });
  }

  function handleBulkMove(toListId: string) {
    const ids = [...selectedIds];
    clearBulkSelect();
    startTransition(async () => {
      await bulkMoveTasks(ids, listId, toListId);
      router.refresh();
    });
  }

  // TSK-19 — keyboard shortcuts. Skipped while typing in a field, so they
  // never fight with normal text entry (add-task input, notes, renames…).
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (TYPING_TAGS.has(target.tagName) || target.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'Escape' && selectedIds.size > 0) {
        e.preventDefault();
        clearBulkSelect();
        return;
      }

      if (e.key === 'n') {
        e.preventDefault();
        addInputRef.current?.focus();
        return;
      }

      if (e.key === 'j' || e.key === 'ArrowDown' || e.key === 'k' || e.key === 'ArrowUp') {
        if (activeVisible.length === 0) return;
        e.preventDefault();
        const down = e.key === 'j' || e.key === 'ArrowDown';
        const currentIndex = activeVisible.findIndex((t) => t.id === focusedId);
        const nextIndex =
          currentIndex === -1
            ? 0
            : Math.min(Math.max(currentIndex + (down ? 1 : -1), 0), activeVisible.length - 1);
        setFocusedId(activeVisible[nextIndex]?.id ?? null);
        return;
      }

      if (e.key === 'e' && focusedId) {
        const task = activeVisible.find((t) => t.id === focusedId);
        if (!task) return;
        e.preventDefault();
        startTransition(async () => {
          await toggleComplete(task.id, task.listId, true);
          router.refresh();
        });
        return;
      }

      if (e.key === 'Enter' && focusedId) {
        e.preventDefault();
        router.push(`/tasks/${listId}?task=${focusedId}`);
        return;
      }

      if (e.key === '[' || e.key === ']') {
        if (lists.length < 2) return;
        const currentIndex = lists.findIndex((l) => l.id === listId);
        if (currentIndex === -1) return;
        e.preventDefault();
        const delta = e.key === ']' ? 1 : -1;
        const nextIndex = (currentIndex + delta + lists.length) % lists.length;
        const target = lists[nextIndex];
        if (target) router.push(`/tasks/${target.id}`);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeVisible, focusedId, listId, lists, router, selectedIds.size, startTransition]);

  function handleDragStart(event: DragStartEvent) {
    // Haptic parity with useLongPress's own vibrate cue on bulk-select — a
    // touch-activated drag is the same "held long enough" moment, just
    // routed to reorder instead. Mouse/keyboard activation has no vibrate
    // API to call, and dnd-kit's activatorEvent tells them apart.
    if (event.activatorEvent instanceof TouchEvent) {
      navigator.vibrate?.(10);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active: a, over, delta } = event;
    // A long-press lift that's released back in (or near) its starting spot,
    // on touch, means the user held the row without dragging it anywhere —
    // the same gesture useLongPress uses for bulk-select elsewhere, just
    // routed through the drag sensor this time (see dndSensors.ts). Toggle
    // selection instead of attempting a reorder. The delta guard (not just
    // `a.id === over.id`) also catches a real drag that scrolled the list
    // and landed back over its own starting row without moving far.
    if (
      event.activatorEvent instanceof TouchEvent &&
      Math.hypot(delta.x, delta.y) < 12 &&
      (!over || a.id === over.id)
    ) {
      toggleBulkSelect(String(a.id));
      return;
    }
    // Guards the same invariant as TaskItem's dragDisabled prop (which hides
    // the handle). The virtual Starred view has no manual order at all — its
    // Sort options exclude 'manual', but this is a defensive belt-and-braces
    // check against that invariant rather than relying on it alone.
    if (virtualList || sortBy !== 'manual') return;
    if (!over || a.id === over.id) return;
    // dnd-kit's SortableContext (below) is seeded with activeVisible's ids —
    // the actually-rendered order, which pinDueTodayAndOverdue always
    // reorders (pinning due-today/overdue tasks first) regardless of sortBy,
    // even 'manual'. active/over indices from dnd-kit are positions within
    // THAT array, not raw `tasks`'s manual order — computing old/newIndex
    // against `tasks` directly (as this used to) silently desyncs the two
    // whenever any visible task is pinned, producing a no-op or wrong swap.
    // This was a latent bug even before whole-row drag shipped; it just
    // never got exercised, since the only way to drag before then was via
    // the (separately broken, invisible-on-hover) handle.
    const oldVisibleIndex = activeVisible.findIndex((t) => t.id === a.id);
    const newVisibleIndex = activeVisible.findIndex((t) => t.id === over.id);
    if (oldVisibleIndex === -1 || newVisibleIndex === -1) return;
    const reorderedVisible = arrayMove(activeVisible, oldVisibleIndex, newVisibleIndex);
    // Splice the reordered visible/active subset back into the full task
    // list, preserving the relative position of everything dnd-kit never
    // saw (completed tasks; tasks hidden by the current filter) — walk
    // `tasks` in its original order, substituting each visible-subset
    // member's id with the next id from `reorderedVisible`, in order.
    const visibleIds = new Set(activeVisible.map((t) => t.id));
    let vi = 0;
    const ids = tasks.map((t) => {
      if (!visibleIds.has(t.id)) return t.id;
      const next = reorderedVisible[vi];
      vi += 1;
      return next?.id ?? t.id;
    });
    startTransition(async () => {
      applyTaskAction({ type: 'reorder', ids });
      await reorderTasks(listId, ids);
      router.refresh();
    });
  }

  function handleAddTask() {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setNewTitle('');
    const optimisticTask: TaskRow = {
      id: `optimistic-${Date.now()}`,
      listId,
      title: trimmed,
      notes: null,
      completedAt: null,
      parentId: null,
      favorite: false,
      dueDate: null,
      dueTime: null,
      recurrenceRule: null,
      createdAt: Math.floor(Date.now() / 1000),
      subtaskCount: 0,
      subtaskDoneCount: 0,
    };
    startTransition(async () => {
      applyTaskAction({ type: 'add', task: optimisticTask });
      onTaskAdded?.(optimisticTask);
      await createTask(listId, trimmed);
      router.refresh();
    });
  }

  // Losing focus for any reason (including iOS's native keyboard-accessory
  // Done/checkmark, which fires a blur but no keydown) commits the same as
  // Enter — see the hook's own doc comment. handleAddTask already no-ops on
  // an empty title, so this is always safe to call.
  const addTaskCommitHandlers = useCommitOnEnterOrBlur(handleAddTask);

  function toggleCompletedSection() {
    const next = !completedOpen;
    startTransition(async () => {
      setCompletedOpen(next);
      await updatePrefs(listId, { showCompleted: next });
      router.refresh();
    });
  }

  // Shared between the desktop and mobile presentations Menu already forks
  // internally (Popover / Drawer) — same entries, same handlers either way.
  const menuItems: MenuEntry[] = [
    ...(!filterFitsInline
      ? ([
          { type: 'label', label: 'Filter' },
          ...FILTERS.map((f): MenuEntry => ({
            label: f.label,
            checked: filter === f.value,
            onSelect: () => setFilter(f.value),
          })),
          { type: 'separator' },
        ] satisfies MenuEntry[])
      : []),
    { type: 'label', label: 'Sort by' },
    ...sortOptions.map((opt): MenuEntry => ({
      label: opt.label,
      checked: sortBy === opt.value,
      onSelect: () => setSortBy(opt.value),
    })),
    // Rename/colour/delete-list/delete-completed are all real-list-only
    // operations the virtual Starred view has no meaning for — it owns no
    // list row and no tasks of its own to delete.
    ...(!virtualList
      ? ([
          { type: 'separator' },
          ...(completed.length > 0
            ? ([
                {
                  label: 'Delete completed tasks',
                  destructive: true,
                  onSelect: () => setDeleteCompletedOpen(true),
                },
              ] satisfies MenuEntry[])
            : []),
          { label: 'Delete list', destructive: true, onSelect: () => setDeleteOpen(true) },
        ] satisfies MenuEntry[])
      : []),
  ];

  return (
    // data-menu-open: read by TaskItem.module.css's .dragHandle rule — see
    // its own doc comment for why a WebKit compositing bug needs the
    // handles hidden outright while this menu is open, not just
    // z-index/layer tricks.
    <div className={styles.pane} data-menu-open={menuOpen} suppressHydrationWarning>
      <div className={styles.stickyHeader}>
        <header className={styles.header}>
          <div className={styles.titleRow} ref={titleRowRef}>
            {virtualList ? (
              <span className={styles.starredIcon} aria-hidden>
                ★
              </span>
            ) : (
              <span
                className={styles.dot}
                style={{ background: listDotColor(list.color) }}
                aria-hidden
              />
            )}
            {renaming ? (
              <input
                ref={renameInputRef}
                className={styles.titleInput}
                // Pixel-measured width (see the useLayoutEffect above) instead
                // of stretching to fill the row — keeps the input close to the
                // title's own footprint while editing, matching how it looked
                // as plain text. Falls back to a ch-based guess only for the
                // very first paint, before the layout effect has measured
                // anything yet.
                style={{ width: renameInputWidth ?? `${renameTitle.length + 2}ch` }}
                value={renameTitle}
                aria-label={`Rename "${list.title}"`}
                onChange={(e) => setRenameTitle(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') cancelRename();
                }}
              />
            ) : (
              // Double-click-to-rename is a mouse-only convenience affordance
              // layered on top of a plain, fully-readable heading — there's no
              // separate keyboard-accessible rename entry point by design
              // (matches ListSidebar's identical row-title pattern). Same
              // e.detail === 2 trick: desktop only; mobile renames through the
              // sidebar's Drawer instead.
              // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
              <h1
                className={styles.title}
                onClick={(e) => {
                  if (!virtualList && !isMobile && e.detail === 2) startRename();
                }}
              >
                {list.title}
              </h1>
            )}
            <span className={styles.count}>
              {active.length} {active.length === 1 ? 'task' : 'tasks'}
            </span>
            <span className={styles.spacer} aria-hidden />
            {/* Filter renders inline here (next to the menu) when
              filterFitsInline says there's room for it — otherwise it folds
              into the menu below instead, so it's never lost, just relocated
              depending on available space and title length. Same logic on
              mobile as desktop; a mobile screen just hits the "doesn't fit"
              branch more often. */}
            {filterFitsInline && (
              <SegmentedControl<Filter>
                value={filter}
                onChange={setFilter}
                options={FILTERS}
                size="sm"
                aria-label="Filter tasks"
              />
            )}
            <Menu
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              align="right"
              aria-label={`Options for "${list.title}"`}
              items={menuItems}
              trigger={
                <button
                  type="button"
                  className={styles.menuBtn}
                  aria-label={`Options for "${list.title}"`}
                  onClick={() => setMenuOpen((o) => !o)}
                >
                  <Icon name="ellipsis-vertical" size="sm" aria-hidden />
                </button>
              }
            />
          </div>
          {/* Hidden measurement-only clone of the fully-inline row (dot + title
            + count + spacer + Filter + menu button), used to decide
            filterFitsInline above. position: absolute + visibility: hidden
            means it never affects real layout, and is automatically removed
            from both the tab order and the accessibility tree (unlike
            opacity: 0, which keeps an element focusable) — aria-hidden is
            added anyway for clarity of intent. Rendering the *real* CSS
            classes here (not hand-summed widths) is what lets this measure
            gaps/padding correctly without duplicating that arithmetic. */}
          <div
            ref={shadowRowRef}
            className={styles.titleRow}
            style={{
              position: 'absolute',
              visibility: 'hidden',
              pointerEvents: 'none',
              top: -9999,
              left: 0,
              width: 'max-content',
            }}
            aria-hidden
          >
            {virtualList ? (
              <span className={styles.starredIcon} aria-hidden>
                ★
              </span>
            ) : (
              <span className={styles.dot} style={{ background: listDotColor(list.color) }} />
            )}
            <h1 className={styles.title}>{list.title}</h1>
            <span className={styles.count}>
              {active.length} {active.length === 1 ? 'task' : 'tasks'}
            </span>
            <span className={styles.spacer} />
            <SegmentedControl<Filter>
              value={filter}
              onChange={() => {}}
              options={FILTERS}
              size="sm"
              aria-label="Filter tasks"
            />
            <button type="button" className={styles.menuBtn} aria-label="Options">
              <Icon name="ellipsis-vertical" size="sm" aria-hidden />
            </button>
          </div>
        </header>

        {/* A new task needs an owning list — the virtual Starred view has none. */}
        {!virtualList && (
          <div className={styles.addRow}>
            <span className={styles.addPlus} aria-hidden>
              +
            </span>
            <input
              ref={addInputRef}
              className={styles.addInput}
              placeholder="Add a task and press Enter…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              {...addTaskCommitHandlers}
            />
          </div>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDeleteList}
        title="Delete list"
        message={
          <>
            Delete "{list.title}"? This permanently removes the list and all of its tasks. This
            can't be undone.
          </>
        }
        confirmLabel="Delete list"
        destructive
      />

      <ConfirmDialog
        open={deleteCompletedOpen}
        onClose={() => setDeleteCompletedOpen(false)}
        onConfirm={confirmDeleteCompleted}
        title={`Delete ${completed.length} completed ${completed.length === 1 ? 'task' : 'tasks'}`}
        message={
          <>
            This permanently removes every completed task in "{list.title}" and their subtasks. This
            can't be undone.
          </>
        }
        confirmLabel="Delete completed tasks"
        destructive
      />

      <DndContext
        id="tasks-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={activeVisible.map((t) => t.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className={styles.taskList}>
            {activeVisible.map((task) => (
              <TaskItem
                key={task.id}
                task={task}
                showCompleted={completedExpanded}
                selected={task.id === selectedTaskId}
                keyFocused={task.id === focusedId}
                bulkSelected={selectedIds.has(task.id)}
                onBulkToggle={virtualList ? undefined : toggleBulkSelect}
                onMutated={refresh}
                onFieldPatch={
                  onTaskFieldPatch ? (patch) => onTaskFieldPatch(task.id, patch) : undefined
                }
                swipeOpen={swipeOpenTaskId === task.id}
                onSwipeOpen={() => setSwipeOpenTaskId(task.id)}
                onSwipeClose={() => setSwipeOpenTaskId((id) => (id === task.id ? null : id))}
                dragDisabled={!!virtualList || sortBy !== 'manual'}
                showListBadge={!!virtualList}
                listTitle={task.listTitle}
                listColor={task.listColor}
                detailBasePath={virtualList ? '/tasks/starred' : undefined}
              />
            ))}
            {activeVisible.length === 0 && (
              <p className={styles.empty}>
                {virtualList
                  ? 'No starred tasks — tap the star on a task to add it here.'
                  : filter === 'overdue'
                    ? 'Nothing overdue.'
                    : tasks.length === 0
                      ? 'No tasks yet — type above and press Enter to add one.'
                      : 'All done! Completed tasks are below.'}
              </p>
            )}
          </div>
        </SortableContext>
      </DndContext>

      {showCompletedSection && (
        <div className={styles.completed}>
          <button
            type="button"
            className={styles.completedHeader}
            aria-expanded={completedExpanded}
            onClick={toggleCompletedSection}
          >
            <span>Completed</span>
            <span className={styles.completedCount}>· {completed.length}</span>
            <span className={styles.completedChevron}>{completedExpanded ? '▴' : '▾'}</span>
          </button>
          {completedExpanded && (
            <div className={styles.taskList}>
              {completed.map((task) => (
                <TaskItem
                  key={task.id}
                  task={task}
                  showCompleted
                  selected={task.id === selectedTaskId}
                  bulkSelected={selectedIds.has(task.id)}
                  onBulkToggle={virtualList ? undefined : toggleBulkSelect}
                  onMutated={refresh}
                  onFieldPatch={
                    onTaskFieldPatch ? (patch) => onTaskFieldPatch(task.id, patch) : undefined
                  }
                  swipeOpen={swipeOpenTaskId === task.id}
                  onSwipeOpen={() => setSwipeOpenTaskId(task.id)}
                  onSwipeClose={() => setSwipeOpenTaskId((id) => (id === task.id ? null : id))}
                  dragDisabled={!!virtualList || sortBy !== 'manual'}
                  showListBadge={!!virtualList}
                  listTitle={task.listTitle}
                  listColor={task.listColor}
                  detailBasePath={virtualList ? '/tasks/starred' : undefined}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {!virtualList && selectedIds.size > 0 && (
        <BulkActionBar
          count={selectedIds.size}
          lists={lists}
          currentListId={listId}
          onDelete={handleBulkDelete}
          onMove={handleBulkMove}
          onCancel={clearBulkSelect}
        />
      )}
    </div>
  );
}
