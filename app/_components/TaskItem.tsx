'use client';

import { Checkbox, ConfirmDialog, Icon, useLongPress } from '@sovereignfs/ui';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Link from 'next/link';
import { useOptimistic, useRef, useState, useTransition } from 'react';
import { deleteTask, toggleComplete } from '../_lib/actions';
import { formatDueDate, isOverdue } from '../_lib/date';
import { listDotColor } from '../_lib/colors';
import { summaryLabel } from '../_lib/recurrence';
import { useIsMobile } from '../_lib/useIsMobile';
import type { TaskRow } from '../_lib/types';
import GripIcon from './GripIcon';
import ProgressRing from './ProgressRing';
import StarButton from './StarButton';
import SubtaskList from './SubtaskList';
import styles from './TaskItem.module.css';

// Mobile-only swipe-to-reveal (Done + Delete) — width per button (px), must
// match .swipeDoneBtn/.swipeDeleteBtn's own width in TaskItem.module.css. Two
// buttons, unlike ListSidebar's single Delete action.
const SWIPE_BTN_WIDTH = 64;
const SWIPE_REVEAL_WIDTH = SWIPE_BTN_WIDTH * 2;

interface Props {
  task: TaskRow;
  showCompleted: boolean;
  selected: boolean;
  /** TSK-19 — keyboard row focus (j/k), distinct from `selected` (detail pane open). */
  keyFocused?: boolean;
  /** TSK-20/21 — this row is part of the active bulk selection. */
  bulkSelected?: boolean;
  /** Ctrl/cmd-click or long-press toggles this row's membership in the bulk selection. */
  onBulkToggle?: (taskId: string) => void;
  onMutated: () => void;
  /**
   * Called synchronously with a partial update the moment an optimistic
   * toggle (completion, star) fires on this row — see StarButton's
   * onOptimisticChange doc comment for why. Only provided by TasksPane when
   * it's rendered inside MobileTasksCarousel's own decoupled task cache;
   * undefined on desktop, where router.refresh() already re-renders with
   * fresh server props within the same transition.
   */
  onFieldPatch?: (patch: Partial<TaskRow>) => void;
  /** Mobile swipe-to-reveal (Done/Delete) — lifted to TasksPane so opening
   *  one row's reveal auto-closes any other, same coordination pattern as
   *  ListSidebar's swipeOpenId. */
  swipeOpen?: boolean;
  onSwipeOpen?: () => void;
  onSwipeClose?: () => void;
  /**
   * True whenever TasksPane's sortBy isn't 'manual'. Dragging a row while the
   * list is displayed in a derived order (date/due date/title) would compute
   * the wrong reorder — dnd-kit sees the *visible* (sorted) index positions,
   * not the underlying manual sortOrder, so a drop would silently apply the
   * sorted view's index gap to the real order and corrupt it. Reordering
   * only makes sense in Manual sort, so the handle is hidden and dragging
   * disabled otherwise.
   */
  dragDisabled?: boolean;
  /** Renders a small source-list badge (colour dot + list name) next to the
   *  due-date row — only set by the virtual "Starred" view (TSK-28), where
   *  rows are aggregated across lists and would otherwise lose that context. */
  showListBadge?: boolean;
  listTitle?: string;
  listColor?: string | null;
  /** Overrides the detail link's base path (default `/tasks/${task.listId}`)
   *  so the Starred view's detail links stay in `/tasks/starred?task=…`
   *  instead of jumping to the task's own list. */
  detailBasePath?: string;
}

export default function TaskItem({
  task,
  showCompleted,
  selected,
  keyFocused = false,
  bulkSelected = false,
  onBulkToggle,
  onMutated,
  onFieldPatch,
  swipeOpen = false,
  onSwipeOpen,
  onSwipeClose,
  dragDisabled = false,
  showListBadge = false,
  listTitle,
  listColor,
  detailBasePath,
}: Props) {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  // Instant local hide on Delete — deleteTask + onMutated's eventual refresh
  // still run, but the row doesn't sit there for that round trip.
  const [locallyDeleted, setLocallyDeleted] = useState(false);
  // Swipe-to-delete is a single edge-zone gesture with no intermediate "are
  // you sure" affordance built in (unlike the desktop detail pane's Delete
  // button, which is a deliberate second tap) — a slightly-too-far swipe on
  // the row can reveal and immediately land on the same Delete button in one
  // continuous gesture. Gate the actual delete behind the same ConfirmDialog
  // ListSidebar's own swipe-to-delete already uses, instead of deleting on
  // tap.
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  // TSK-20/21: long-press to enter bulk-select on touch (the touch equivalent of
  // a desktop ctrl/cmd-click). The DS hook carries the slop threshold,
  // pointercancel handling, time-boxed click suppression, and OS
  // callout/selection suppression the previous hand-rolled timer lacked.
  // Disabled whenever the drag sensor can own the hold gesture instead
  // (mobile + reorder possible) — TasksPane's handleDragEnd toggles bulk
  // select itself when that lift is released in place, so only one of the
  // two mechanisms should be listening for the hold at a time. When
  // dragDisabled (derived sort order — dnd-kit can't compute a valid
  // reorder there), this hook stays the only path to bulk-select, same as
  // before this feature existed.
  const longPress = useLongPress({
    onLongPress: () => onBulkToggle?.(task.id),
    disabled: !onBulkToggle || (isMobile && !dragDisabled),
  });
  const rowRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    locked: 'horizontal' | 'vertical' | null;
  } | null>(null);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: dragDisabled,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  // Whenever a reorder is actually possible (dragDisabled hides the handle
  // and disables useSortable in the same cases): let a press-and-drag
  // anywhere on the row lift it — but only on desktop/mouse. Same reasoning
  // as ListSidebar's identical row-forwarding (see that component's own
  // comment) for *why* whole-row forwarding is convenient: the
  // hover-revealed handle is easy to miss, and MouseSensor's own 8px
  // activation distance already keeps a plain click from being mistaken for
  // a drag, so forwarding the full `listeners` object here carries no
  // narrow-desktop-window risk.
  //
  // On mobile this whole-row forwarding is deliberately withheld (fix for
  // findings doc Issue 4): TouchSensor's long-press-anywhere-on-the-row
  // lift competed with the carousel's own horizontal swipe-to-navigate
  // gesture — a swipe with any realistic vertical wobble could be captured
  // as a drag lift instead of becoming carousel navigation, sometimes
  // leaving a stuck-looking hover/reveal state behind (iOS Safari's
  // sticky-hover-after-touch quirk). Touch reorder now goes exclusively
  // through the dedicated `.dragHandle` button below, which is the only
  // element still carrying `listeners` on mobile — see its own
  // `@media (max-width: 768px)` CSS block for the matching touch-target
  // change (now interactive there, not just on hover-capable devices).
  const rowDragListeners = dragDisabled || isMobile ? undefined : listeners;

  // Optimistic completion: the checkbox flips instantly on tap instead of
  // waiting on toggleComplete's DB round trip (subtask cascade + main update
  // + recurring-task spawn check, all sequential) plus whatever refresh
  // onMutated triggers — on mobile that chain is 2-3 stacked network round
  // trips, which read as the tap simply not registering. React reverts this
  // back to `task.completedAt` once the transition below settles.
  const [isComplete, setOptimisticComplete] = useOptimistic(
    task.completedAt !== null,
    (_prev: boolean, next: boolean) => next,
  );
  const [, startTransition] = useTransition();
  const hasSubtasks = task.subtaskCount > 0;
  // Uses the optimistic value (not task.completedAt) so a just-checked task's
  // overdue badge also clears immediately rather than lingering until refresh.
  const overdue = !isComplete && isOverdue(task.dueDate, null);
  const detailHref = `${detailBasePath ?? `/tasks/${task.listId}`}?task=${task.id}`;

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticComplete(checked);
      onFieldPatch?.({ completedAt: checked ? Math.floor(Date.now() / 1000) : null });
      await toggleComplete(task.id, task.listId, checked);
      onMutated();
    });
  }

  // Mobile swipe-to-reveal (Done + Delete), same edge-zone technique as
  // ListSidebar's swipe-to-delete: a drag can only *start* from the narrow
  // .swipeEdgeZone strip in .row's own right padding (see TaskItem.module.css)
  // so a swipe starting anywhere else on the row still becomes the mobile
  // carousel's native swipe-between-lists gesture, not this reveal.
  function handleRowPointerDown(e: React.PointerEvent) {
    if (!isMobile) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, locked: null };
  }

  function handleRowPointerMove(e: React.PointerEvent) {
    const state = dragState.current;
    if (!state) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      state.locked = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    }
    if (state.locked !== 'horizontal') return;
    e.preventDefault();
    const base = swipeOpen ? -SWIPE_REVEAL_WIDTH : 0;
    const next = Math.min(0, Math.max(-SWIPE_REVEAL_WIDTH, base + dx));
    if (rowRef.current) rowRef.current.style.transform = `translateX(${next}px)`;
  }

  function handleRowPointerUp(e: React.PointerEvent) {
    const state = dragState.current;
    dragState.current = null;
    if (!state || state.locked !== 'horizontal') return;
    const dx = e.clientX - state.startX;
    const base = swipeOpen ? -SWIPE_REVEAL_WIDTH : 0;
    const finalX = Math.min(0, Math.max(-SWIPE_REVEAL_WIDTH, base + dx));
    if (rowRef.current) rowRef.current.style.transform = '';
    if (finalX < -SWIPE_REVEAL_WIDTH / 2) onSwipeOpen?.();
    else onSwipeClose?.();
  }

  // While the reveal is open, any tap on the row's own content (checkbox,
  // title, star…) closes it instead of performing that element's normal
  // action — otherwise the tap needed to dismiss the reveal would also
  // toggle/navigate/star. Capture phase + preventDefault so it beats the
  // checkbox's own native check-on-click before onChange ever fires.
  function handleRowClickCapture(e: React.MouseEvent) {
    if (!swipeOpen) return;
    e.preventDefault();
    e.stopPropagation();
    onSwipeClose?.();
  }

  function handleSwipeComplete() {
    onSwipeClose?.();
    handleToggle(!isComplete);
  }

  function handleSwipeDelete() {
    onSwipeClose?.();
    setDeleteConfirmOpen(true);
  }

  function confirmDelete() {
    setDeleteConfirmOpen(false);
    setLocallyDeleted(true);
    startTransition(async () => {
      await deleteTask(task.id, task.listId);
      onMutated();
    });
  }

  function handleMainClick(e: React.MouseEvent) {
    // Let the DS hook swallow the click that may follow a long-press (it
    // preventDefaults within its time-boxed window); if it did, stop here so
    // the tap doesn't also navigate.
    longPress.onClick(e);
    if (e.defaultPrevented) return;
    // Desktop bulk-select via ctrl/cmd-click (touch uses the long-press above).
    if (onBulkToggle && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onBulkToggle(task.id);
    }
  }

  if (locallyDeleted) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={[
        styles.wrapper,
        selected ? styles.selected : '',
        bulkSelected ? styles.bulkSelected : '',
        keyFocused ? styles.keyFocused : '',
        isDragging ? styles.dragging : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {!dragDisabled && (
        <button
          type="button"
          className={styles.dragHandle}
          aria-label="Drag to reorder"
          {...attributes}
          {...listeners}
        >
          <GripIcon />
        </button>
      )}
      {/* Positioned anchor scoped to just the row's own height — not
          .wrapper's, which also contains the expandable SubtaskList below.
          .swipeActionsBg is inset:0 against its nearest positioned ancestor;
          anchoring it here (rather than .wrapper) keeps it from stretching
          down behind the subtask list once expanded, which used to leave the
          Done/Delete panel visible underneath it. */}
      <div className={styles.rowContainer}>
        {/* Mobile-only swipe-to-reveal, sitting behind .row (see its own
            z-index/position in the CSS) — .row has an opaque, inherited
            background so this stays hidden until dragged into view. */}
        <div className={styles.swipeActionsBg} aria-hidden={!swipeOpen}>
          <button
            type="button"
            className={styles.swipeDoneBtn}
            aria-label={`Mark "${task.title}" ${isComplete ? 'incomplete' : 'complete'}`}
            onClick={handleSwipeComplete}
          >
            <Icon name={isComplete ? 'rotate-ccw' : 'check'} size="md" aria-hidden />
          </button>
          <button
            type="button"
            className={styles.swipeDeleteBtn}
            aria-label={`Delete "${task.title}"`}
            onClick={handleSwipeDelete}
          >
            <Icon name="trash-2" size="md" aria-hidden />
          </button>
        </div>
        <div
          ref={rowRef}
          className={styles.row}
          style={{ transform: swipeOpen ? `translateX(-${SWIPE_REVEAL_WIDTH}px)` : undefined }}
          onClickCapture={handleRowClickCapture}
          {...rowDragListeners}
        >
          {/* data-no-dnd: Checkbox doesn't forward arbitrary props to its own
            root, so the exclusion is marked on this wrapper instead — a
            long-press on the checkbox should hit its own tap target, not
            lift the row. display: contents keeps it out of the flex layout. */}
          <div data-no-dnd style={{ display: 'contents' }}>
            <Checkbox
              checked={isComplete}
              onChange={handleToggle}
              label=""
              aria-label={`Mark "${task.title}" ${isComplete ? 'incomplete' : 'complete'}`}
            />
          </div>

          <Link
            href={detailHref}
            className={styles.main}
            // Spread the long-press handlers (pointer events, onContextMenu, and
            // the coarse-pointer-only touch-callout/user-select/touch-action
            // `style`), then override onClick to compose the hook's click
            // suppression with the desktop ctrl/cmd-click bulk toggle.
            {...longPress}
            onClick={handleMainClick}
          >
            <span
              className={[styles.title, isComplete ? styles.complete : '']
                .filter(Boolean)
                .join(' ')}
            >
              {task.title}
            </span>
            {task.notes && <span className={styles.note}>{task.notes}</span>}
            {showListBadge && listTitle && (
              <span className={styles.listBadge}>
                <span
                  className={styles.listBadgeDot}
                  style={{ background: listDotColor(listColor) }}
                  aria-hidden
                />
                {listTitle}
              </span>
            )}
            {(task.dueDate || task.recurrenceRule) && (
              <span className={styles.dueRow}>
                {task.dueDate && (
                  <span
                    className={[styles.due, overdue ? styles.overdue : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Icon name="calendar" size="xs" aria-hidden />
                    {formatDueDate(task.dueDate, task.dueTime)}
                  </span>
                )}
                {task.recurrenceRule && (
                  <span className={styles.repeatIndicator}>
                    <Icon name="rotate-ccw" size="xs" aria-hidden />
                    {summaryLabel(task.recurrenceRule)}
                  </span>
                )}
              </span>
            )}
          </Link>

          {/* data-no-dnd: subtask ring + star should take a plain tap/long-press
            as their own action, not lift the row for reorder. */}
          <div className={styles.right} data-no-dnd>
            {hasSubtasks && (
              <button
                type="button"
                className={styles.ringBtn}
                aria-label={expanded ? 'Hide subtasks' : 'Show subtasks'}
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
              >
                <ProgressRing done={task.subtaskDoneCount} total={task.subtaskCount} />
                <Icon
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size="sm"
                  aria-hidden
                  className={styles.subtaskChevron}
                />
              </button>
            )}
            {/* Always last (rightmost) so its position stays fixed whether or
              not the subtask cluster above is present — .main's flex:1
              already pushes .right flush to the row's edge, so ordering this
              last is enough; no reserved space needed. */}
            <StarButton
              taskId={task.id}
              listId={task.listId}
              favorite={task.favorite}
              onMutated={onMutated}
              onOptimisticChange={(next) => onFieldPatch?.({ favorite: next })}
            />
          </div>
          {isMobile && (
            // The only region a swipe-to-reveal drag can start from — sits in
            // .row's own empty right padding (beyond .right's actual content),
            // so it never overlaps the star/progress-ring tap targets. See
            // .swipeEdgeZone in TaskItem.module.css.
            <div
              className={styles.swipeEdgeZone}
              aria-hidden
              data-no-dnd
              onPointerDown={handleRowPointerDown}
              onPointerMove={handleRowPointerMove}
              onPointerUp={handleRowPointerUp}
              onPointerCancel={handleRowPointerUp}
            />
          )}
        </div>
      </div>

      {expanded && (
        <SubtaskList
          parentId={task.id}
          listId={task.listId}
          showCompleted={showCompleted}
          parentCompletedAt={task.completedAt}
          parentSubtaskCount={task.subtaskCount}
          parentSubtaskDoneCount={task.subtaskDoneCount}
          onMutated={onMutated}
        />
      )}

      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={confirmDelete}
        title="Delete task"
        message={<>Delete "{task.title}"? This can't be undone.</>}
        confirmLabel="Delete task"
        destructive
      />
    </div>
  );
}
