'use client';

import { DndContext, closestCenter } from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Button,
  ConfirmDialog,
  Icon,
  Popover,
  Sheet,
  Tooltip,
  useCommitOnEnterOrBlur,
  useDoubleTapHandler,
} from '@sovereignfs/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { createList, deleteList, reorderLists, updateList, updateListColor } from './_lib/actions';
import GripIcon from './_components/GripIcon';
import TasksSettings from './_components/TasksSettings';
import { LIST_SWATCHES, listDotColor } from './_lib/colors';
import { REORDER_AUTO_SCROLL, useReorderSensors } from './_lib/dndSensors';
import { useIsMobile } from './_lib/useIsMobile';
import type { ListRow } from './_lib/types';
import { STARRED_LIST_ID } from './_lib/virtualLists';
import styles from './ListSidebar.module.css';

interface Props {
  lists: ListRow[];
  /** Count of active starred tasks across every list — drives the pinned
   *  "Starred" row's badge (TSK-28). Threaded down from layout.tsx's own
   *  countStarredTasks() call rather than fetched here, since this is a
   *  client component and every route (not just /tasks/starred) renders it. */
  starredCount: number;
}

type ListAction =
  | { type: 'add'; list: ListRow }
  | { type: 'delete'; id: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'color'; id: string; color: string }
  | { type: 'reorder'; ids: string[] };

function listsReducer(state: ListRow[], action: ListAction): ListRow[] {
  switch (action.type) {
    case 'add':
      return [...state, action.list];
    case 'delete':
      return state.filter((l) => l.id !== action.id);
    case 'rename':
      return state.map((l) => (l.id === action.id ? { ...l, title: action.title } : l));
    case 'color':
      return state.map((l) => (l.id === action.id ? { ...l, color: action.color } : l));
    case 'reorder': {
      const byId = new Map(state.map((l) => [l.id, l]));
      return action.ids.map((id) => byId.get(id)).filter((l): l is ListRow => l !== undefined);
    }
  }
}

export default function ListSidebar({ lists: initialLists, starredCount }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [lists, applyListAction] = useOptimistic(initialLists, listsReducer);
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  // The small colour-swatch popover triggered by double-clicking/double-
  // tapping a list's dot — same interaction and same Popover on both desktop
  // and mobile now (see ListItem).
  const [colorPickerOpenId, setColorPickerOpenId] = useState<string | null>(null);
  // Mobile only — which row (if any) currently has its swipe-to-delete action
  // revealed. A single id (not a Set) means opening one row's reveal via a
  // prop-driven re-render automatically slides any previously-open row shut,
  // with no extra "close the others" plumbing needed — see ListItem.
  const [swipeOpenId, setSwipeOpenId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ListRow | null>(null);
  const [query, setQuery] = useState('');
  const [, startTransition] = useTransition();
  const addInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // MouseSensor (handle-initiated, desktop) + TouchSensor (long-press lift,
  // mobile) + KeyboardSensor — see app/_lib/dndSensors.ts for the tuning
  // constants and the data-no-dnd exclusion mechanism.
  const sensors = useReorderSensors();

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  useEffect(() => {
    if (editingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editingId]);

  // First-run swipe-to-delete hint (D2, mobile design-system plan): the edge
  // zone a drag must start from is real but easy to miss against iOS-native
  // full-row swipe conventions. Briefly peek the first row's reveal open then
  // closed, once per browser, so the gesture's existence is shown rather than
  // only documented. Gated on isMobile (not pointer:coarse) because it's
  // demonstrating THIS list's touch gesture specifically, not a general
  // density preference.
  const isMobileSidebar = useIsMobile();
  const firstListId = lists[0]?.id;
  useEffect(() => {
    if (!isMobileSidebar || !firstListId) return;
    if (localStorage.getItem('tasks:seen-swipe-hint')) return;
    const openTimer = setTimeout(() => setSwipeOpenId(firstListId), 500);
    const closeTimer = setTimeout(() => {
      setSwipeOpenId(null);
      localStorage.setItem('tasks:seen-swipe-hint', '1');
    }, 1400);
    return () => {
      clearTimeout(openTimer);
      clearTimeout(closeTimer);
    };
    // firstListId is a dependency for correctness (avoids a stale id in the
    // closure), but the localStorage guard above means this is still
    // effectively once-per-browser — a reorder that changes which list is
    // first won't re-peek once the flag is set.
  }, [isMobileSidebar, firstListId]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q) router.push(`/tasks/search?q=${encodeURIComponent(q)}`);
  }

  function handleCreate() {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    setNewTitle('');
    setAdding(false);
    startTransition(async () => {
      applyListAction({
        type: 'add',
        list: { id: `optimistic-${Date.now()}`, title: trimmed, color: null, openCount: 0 },
      });
      const id = await createList(trimmed);
      router.push(`/tasks/${id}`);
      router.refresh();
    });
  }

  // Losing focus for any reason (including iOS's native keyboard-accessory
  // Done/checkmark, which fires a blur but no keydown) commits the same as
  // Enter — see the hook's own doc comment. handleCreate already no-ops on
  // an empty title, so this is always safe to call.
  const createListCommitHandlers = useCommitOnEnterOrBlur(handleCreate);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    // A mouse-driven drag (desktop) leaves the handle <button> focused
    // (native pointerdown-focuses-button behavior); dnd-kit never blurs it
    // after drop, so :focus-within keeps the grip revealed on the dragged
    // row even once the pointer has moved elsewhere — alongside whatever row
    // is now genuinely hovered. A touch-driven drag (mobile, no handle)
    // leaves .rowInner focused instead, which carries `attributes` itself
    // there — see ListItem. Release focus so only real hover governs
    // visibility. Keyboard-driven reorders intentionally keep focus on
    // whichever element carries `attributes` so arrow-key navigation can
    // continue, so this only fires for mouse/touch input.
    if (!(event.activatorEvent instanceof KeyboardEvent)) {
      (document.activeElement as HTMLElement | null)?.blur();
    }

    // Also covers a long-press lift released back in place (touch) — unlike
    // TaskItem, lists have no select-on-release semantics, so this is simply
    // a no-op; dnd-kit's own click suppression after an activated touch drag
    // already keeps it from also navigating.
    if (!over || active.id === over.id) return;
    const oldIndex = lists.findIndex((l) => l.id === active.id);
    const newIndex = lists.findIndex((l) => l.id === over.id);
    const ids = arrayMove(lists, oldIndex, newIndex).map((l) => l.id);
    startTransition(async () => {
      applyListAction({ type: 'reorder', ids });
      await reorderLists(ids);
      router.refresh();
    });
  }

  function handleRenameCommit(list: ListRow) {
    const trimmed = editTitle.trim();
    setEditingId(null);
    if (trimmed && trimmed !== list.title) {
      startTransition(async () => {
        applyListAction({ type: 'rename', id: list.id, title: trimmed });
        await updateList(list.id, trimmed);
        router.refresh();
      });
    }
  }

  function handleColor(list: ListRow, color: string) {
    startTransition(async () => {
      applyListAction({ type: 'color', id: list.id, color });
      await updateListColor(list.id, color);
      router.refresh();
    });
  }

  function confirmDelete() {
    const list = deleteTarget;
    setDeleteTarget(null);
    if (!list) return;
    startTransition(async () => {
      applyListAction({ type: 'delete', id: list.id });
      await deleteList(list.id);
      if (pathname === `/tasks/${list.id}`) router.push('/tasks');
      router.refresh();
    });
  }

  return (
    <nav className={styles.nav} aria-label="Task lists">
      <form className={styles.searchRow} onSubmit={submitSearch} role="search">
        <span className={styles.searchIcon} aria-hidden>
          ⌕
        </span>
        <input
          className={styles.searchInput}
          type="search"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tasks"
        />
      </form>

      <div className={styles.header}>
        <span className={styles.heading}>My lists</span>
        <div className={styles.headerActions}>
          <TasksSettings />
          <button
            type="button"
            className={styles.newBtn}
            aria-label="New list"
            onClick={() => setAdding(true)}
          >
            <Icon name="plus" size="sm" aria-hidden />
          </button>
        </div>
      </div>

      {adding && (
        <div className={styles.addRow}>
          <input
            ref={addInputRef}
            className={styles.addInput}
            placeholder="List name"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              createListCommitHandlers.onKeyDown(e);
              if (e.key === 'Escape') {
                setNewTitle('');
                setAdding(false);
              }
            }}
            onBlur={() => {
              createListCommitHandlers.onBlur();
              if (!newTitle.trim()) setAdding(false);
            }}
          />
        </div>
      )}

      {/* Pinned "Starred" row (TSK-28) — rendered outside the DndContext/
          SortableContext below since it's not sortable, not swipeable, and
          has no rename/colour/delete affordances; a plain, always-first
          entry. */}
      <ul className={styles.list}>
        <li
          className={[
            styles.item,
            pathname === `/tasks/${STARRED_LIST_ID}` ? styles.active : '',
          ].join(' ')}
        >
          <div className={styles.rowInner}>
            <span className={styles.starredDot} aria-hidden>
              ★
            </span>
            <Link href={`/tasks/${STARRED_LIST_ID}`} className={styles.link}>
              <span className={styles.listTitle}>Starred</span>
            </Link>
            <span className={styles.trail}>
              {starredCount > 0 && <span className={styles.count}>{starredCount}</span>}
            </span>
          </div>
        </li>
      </ul>

      <DndContext
        id="lists-dnd"
        sensors={sensors}
        autoScroll={REORDER_AUTO_SCROLL}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={lists.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          <ul className={styles.list}>
            {lists.map((list) => (
              <ListItem
                key={list.id}
                list={list}
                active={pathname === `/tasks/${list.id}`}
                editing={editingId === list.id}
                editTitle={editTitle}
                renameInputRef={renameInputRef}
                colorPickerOpen={colorPickerOpenId === list.id}
                swipeOpen={swipeOpenId === list.id}
                onEditTitleChange={setEditTitle}
                onRenameCommit={handleRenameCommit}
                onRenameCancel={(l) => {
                  setEditTitle(l.title);
                  setEditingId(null);
                }}
                onColorPickerToggle={() =>
                  setColorPickerOpenId((id) => (id === list.id ? null : list.id))
                }
                onColorPickerClose={() => setColorPickerOpenId(null)}
                onSwipeOpen={() => setSwipeOpenId(list.id)}
                onSwipeClose={() => setSwipeOpenId(null)}
                onStartRename={(l) => {
                  setEditingId(l.id);
                  setEditTitle(l.title);
                }}
                onColor={handleColor}
                onRequestDelete={(l) => {
                  setSwipeOpenId(null);
                  setDeleteTarget(l);
                }}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      {lists.length === 0 && !adding && (
        <p className={styles.empty}>No lists yet. Create one above.</p>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete list"
        message={
          <>
            Delete "{deleteTarget?.title}"? This permanently removes the list and all of its tasks.
            This can't be undone.
          </>
        }
        confirmLabel="Delete list"
        destructive
      />
    </nav>
  );
}

interface ListItemProps {
  list: ListRow;
  active: boolean;
  editing: boolean;
  editTitle: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  colorPickerOpen: boolean;
  swipeOpen: boolean;
  onEditTitleChange: (value: string) => void;
  onRenameCommit: (list: ListRow) => void;
  onRenameCancel: (list: ListRow) => void;
  onColorPickerToggle: () => void;
  onColorPickerClose: () => void;
  onSwipeOpen: () => void;
  onSwipeClose: () => void;
  onStartRename: (list: ListRow) => void;
  onColor: (list: ListRow, color: string) => void;
  onRequestDelete: (list: ListRow) => void;
}

// Mobile-only swipe-to-delete reveal width (px) — must match .swipeDeleteBtn's
// own width in ListSidebar.module.css; kept as one constant here since the
// drag math (clamping, open/close threshold) needs the same number.
const SWIPE_REVEAL_WIDTH = 72;

// Shared by desktop's standalone colour popover and mobile's combined
// rename+colour drawer — same swatch grid, just a different `onPicked` (the
// popover closes itself after a pick; the drawer stays open so rename and
// colour can both be adjusted before Cancel/Save) and `showLabels`.
//
// showLabels is mobile-only: Tooltip only shows on hover, which touch has no
// equivalent of, so a touch user had no way to see which colour was which
// beyond guessing from the swatch itself. showLabels swaps the hover tooltip
// for an always-visible caption under each swatch and enlarges the swatch
// itself (was 18px, sized for desktop's compact popover — too small a touch
// target on a full-width mobile sheet with room to spare). The selected
// swatch also gets a checkmark on top of the existing ring in both modes —
// the ring alone was easy to miss.
function ColorSwatches({
  list,
  onColor,
  onPicked,
  showLabels = false,
}: {
  list: ListRow;
  onColor: (list: ListRow, color: string) => void;
  onPicked?: () => void;
  showLabels?: boolean;
}) {
  return (
    <div
      className={[styles.swatches, showLabels ? styles.swatchesLabeled : '']
        .filter(Boolean)
        .join(' ')}
    >
      {LIST_SWATCHES.map((s) => {
        const isActive = list.color === s.key;
        const swatchButton = (
          <button
            type="button"
            className={[
              styles.swatch,
              showLabels ? styles.swatchLarge : '',
              isActive ? styles.swatchActive : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{ background: s.token }}
            aria-label={`Set colour ${s.label}`}
            aria-pressed={isActive}
            onClick={() => {
              onColor(list, s.key);
              onPicked?.();
            }}
          >
            {isActive && (
              <Icon
                name="check"
                size={showLabels ? 'sm' : 'xs'}
                className={styles.swatchCheck}
                aria-hidden
              />
            )}
          </button>
        );
        return showLabels ? (
          <div key={s.key} className={styles.swatchCell}>
            {swatchButton}
            <span className={styles.swatchName}>{s.label}</span>
          </div>
        ) : (
          <Tooltip key={s.key} content={s.label} side="bottom">
            {swatchButton}
          </Tooltip>
        );
      })}
    </div>
  );
}

function ListItem({
  list,
  active,
  editing,
  editTitle,
  renameInputRef,
  colorPickerOpen,
  swipeOpen,
  onEditTitleChange,
  onRenameCommit,
  onRenameCancel,
  onColorPickerToggle,
  onColorPickerClose,
  onSwipeOpen,
  onSwipeClose,
  onStartRename,
  onColor,
  onRequestDelete,
}: ListItemProps) {
  const isMobile = useIsMobile();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };
  // Desktop keeps the hover-revealed handle (below); mobile has none —
  // touch reorder is long-press-anywhere on the row, and a small fixed
  // handle is a poor touch target besides. Press-and-drag anywhere on the
  // row lifts it either way (MouseSensor's own 8px activation distance
  // already keeps a plain click (rename/navigate/open colour picker) from
  // being mistaken for a drag), so this is purely which affordance is
  // shown, not a difference in what's draggable.
  const rowDragListeners = listeners;

  // Desktop: e.detail === 2 is the browser's own resolved double-click
  // signal, arriving on the very click that matters — rename can fire (and
  // cancel <Link>'s navigation) immediately, with nothing to preempt.
  function handleDesktopTitleClick(e: React.MouseEvent) {
    if (e.detail === 2) {
      e.preventDefault();
      onStartRename(list);
    }
  }
  // Mobile previously deferred single-tap navigation behind a double-tap
  // detection window (useSingleOrDoubleTap) so a genuine double-tap-to-rename
  // didn't briefly navigate first — but that meant every single tap paid the
  // double-tap window's latency before the carousel would move (decision D1,
  // mobile design-system plan). Single tap now navigates immediately, same as
  // desktop's plain <Link> behaviour; rename/colour move to the explicit "⋯"
  // button below instead of living behind a gesture at all.
  const handleDotDoubleTap = useDoubleTapHandler(() => onColorPickerToggle());

  // Mobile rename Sheet's input: losing focus for any reason (including
  // iOS's native keyboard-accessory Done/checkmark, which fires a blur but
  // no keydown) commits the same as Enter or the Sheet's own Save button —
  // see the hook's own doc comment. The desktop inline-edit row already
  // wires onRenameCommit straight to onBlur itself and doesn't need this.
  const renameSheetCommitHandlers = useCommitOnEnterOrBlur(() => onRenameCommit(list));

  // Mobile-only swipe-to-delete. Tracks the gesture in a ref (not state) so
  // dragging updates the DOM directly at 60fps instead of re-rendering on
  // every pointermove; only the final open/closed outcome (on release)
  // becomes real state (swipeOpen, lifted to ListSidebar), which then drives
  // the declarative transform + CSS transition for the snap animation.
  const rowInnerRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    startX: number;
    startY: number;
    locked: 'horizontal' | 'vertical' | null;
  } | null>(null);

  function handleRowPointerDown(e: React.PointerEvent) {
    if (!isMobile) return;
    // Pointer capture keeps move/up events targeting this element even once
    // the drag has moved well outside its narrow bounds (the whole point of
    // starting from a thin edge strip) — without it, later pointermove events
    // go to whatever the finger is now physically over instead of here.
    e.currentTarget.setPointerCapture(e.pointerId);
    dragState.current = { startX: e.clientX, startY: e.clientY, locked: null };
  }

  function handleRowPointerMove(e: React.PointerEvent) {
    const state = dragState.current;
    if (!state) return;
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;
    if (!state.locked) {
      // Wait for a clear, deliberate movement before committing to a
      // direction — a few px of jitter on a tap shouldn't lock anything.
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      state.locked = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
    }
    // Vertical drags fall through untouched — this is what lets the page's
    // own vertical scroll keep working; only a horizontal drag is ours to
    // handle (touch-action: pan-y on .rowInner tells the browser the same
    // thing, so its native scroll doesn't fight this over a horizontal
    // gesture, including the outer carousel's own horizontal swipe).
    if (state.locked !== 'horizontal') return;
    e.preventDefault();
    const base = swipeOpen ? -SWIPE_REVEAL_WIDTH : 0;
    const next = Math.min(0, Math.max(-SWIPE_REVEAL_WIDTH, base + dx));
    if (rowInnerRef.current) rowInnerRef.current.style.transform = `translateX(${next}px)`;
  }

  function handleRowPointerUp(e: React.PointerEvent) {
    const state = dragState.current;
    dragState.current = null;
    if (!state || state.locked !== 'horizontal') return;
    const dx = e.clientX - state.startX;
    const base = swipeOpen ? -SWIPE_REVEAL_WIDTH : 0;
    const finalX = Math.min(0, Math.max(-SWIPE_REVEAL_WIDTH, base + dx));
    // Clear the manually-driven inline style so the declarative style prop
    // below (based on the swipeOpen state this sets) takes over — the CSS
    // transition on .rowInner then animates from wherever this drag left off
    // to the resolved open/closed position.
    if (rowInnerRef.current) rowInnerRef.current.style.transform = '';
    if (finalX < -SWIPE_REVEAL_WIDTH / 2) onSwipeOpen();
    else onSwipeClose();
  }

  // While a row's delete action is revealed, any tap on its content (title,
  // dot) closes it instead of performing that element's normal action —
  // otherwise the very next tap needed to dismiss the reveal would instead
  // navigate or open the colour picker.
  function closeSwipeOrElse(e: { preventDefault: () => void }, action: () => void) {
    if (swipeOpen) {
      e.preventDefault();
      onSwipeClose();
      return;
    }
    action();
  }

  // Desktop keeps the inline-edit-swap row exactly as before; on mobile,
  // renaming happens in its own full-page sheet (below) instead, so the row
  // itself is never replaced — matching the mockups' dedicated rename screen.
  if (editing && !isMobile) {
    return (
      <li ref={setNodeRef} style={style} className={styles.item}>
        <div className={styles.editRow}>
          <input
            ref={renameInputRef}
            className={styles.renameInput}
            value={editTitle}
            aria-label={`Rename "${list.title}"`}
            onChange={(e) => onEditTitleChange(e.target.value)}
            onBlur={() => onRenameCommit(list)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit(list);
              if (e.key === 'Escape') onRenameCancel(list);
            }}
          />
        </div>
      </li>
    );
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={[styles.item, active ? styles.active : '', isDragging ? styles.dragging : '']
        .filter(Boolean)
        .join(' ')}
    >
      {/* Desktop only — mobile reorders by long-press anywhere on the row
          instead (see rowDragListeners' own comment); a small fixed handle
          is a poor touch target besides. Carries `attributes` (dnd-kit's
          sortable ARIA role/tabIndex) since it's desktop's dedicated,
          focusable drag-initiation element — `.rowInner` below only takes
          `attributes` itself when this handle doesn't exist (mobile), so
          keyboard-initiated reorder always has exactly one carrier. */}
      {!isMobile && (
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
      {/* Mobile-only swipe-to-delete reveal, sitting behind .rowInner (see
          its own z-index/position in the CSS) — .rowInner has an opaque,
          inherited background so this stays hidden until dragged into view. */}
      <div className={styles.swipeDeleteBg} aria-hidden={!swipeOpen}>
        <button
          type="button"
          className={styles.swipeDeleteBtn}
          aria-label={`Delete "${list.title}"`}
          onClick={() => {
            onSwipeClose();
            onRequestDelete(list);
          }}
        >
          <Icon name="trash-2" size="md" aria-hidden />
        </button>
      </div>
      <div
        ref={rowInnerRef}
        className={styles.rowInner}
        style={{ transform: swipeOpen ? `translateX(-${SWIPE_REVEAL_WIDTH}px)` : undefined }}
        {...(isMobile ? attributes : undefined)}
        {...rowDragListeners}
      >
        {isMobile ? (
          // Mobile: the dot is a plain indicator, not its own interactive
          // trigger — colour lives inside the combined rename+colour drawer
          // reached via the title below, per the single-drawer redesign.
          <span
            className={styles.dot}
            style={{ background: listDotColor(list.color) }}
            aria-hidden
          />
        ) : (
          <Popover
            open={colorPickerOpen}
            onClose={onColorPickerClose}
            // 'left' — Popover's .left aligns the panel's *left* edge to the
            // trigger's left edge, expanding rightward into the sidebar.
            // 'right' would align the panel's right edge to this ~8px-wide
            // trigger sitting near the sidebar's left edge, pushing a 180px
            // panel almost entirely off-screen to the left.
            align="left"
            // 6 swatches (18px) + 5 gaps (--sv-space-2, 8px) + padding
            // (--sv-space-3, 12px each side) = 172px — 180 leaves a touch of
            // breathing room. See .swatches for the matching gap.
            width={180}
            // Square corners for this compact swatch grid — the default
            // rounded panel chrome (packages/ui's Popover) reads oddly at
            // this size; every other Popover in this plugin keeps it.
            panelStyle={{ borderRadius: 0 }}
            aria-label={`Change colour for "${list.title}"`}
            trigger={
              <button
                type="button"
                className={styles.dotButton}
                style={{ background: listDotColor(list.color) }}
                aria-label={`Change colour for "${list.title}"`}
                data-no-dnd
                onClick={(e) => closeSwipeOrElse(e, () => handleDotDoubleTap(e))}
              />
            }
          >
            <ColorSwatches list={list} onColor={onColor} onPicked={onColorPickerClose} />
          </Popover>
        )}
        <Link
          href={`/tasks/${list.id}`}
          className={styles.link}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            closeSwipeOrElse(e, () => {
              if (!isMobile) handleDesktopTitleClick(e);
              // Mobile: no interception — the tap navigates immediately via
              // <Link>'s own default behaviour (see D1 comment above).
            });
          }}
        >
          <span className={styles.listTitle}>{list.title}</span>
        </Link>
        <span className={styles.trail}>
          {list.openCount > 0 && <span className={styles.count}>{list.openCount}</span>}
          {isMobile && (
            <button
              type="button"
              className={styles.listOptionsBtn}
              aria-label={`Options for "${list.title}"`}
              data-no-dnd
              onClick={(e) => closeSwipeOrElse(e, () => onStartRename(list))}
            >
              <Icon name="ellipsis-vertical" size="sm" aria-hidden />
            </button>
          )}
        </span>
        {isMobile && (
          // The only region a swipe-to-delete drag can start from — see
          // .swipeEdgeZone in ListSidebar.module.css for why this is a
          // separate element rather than handlers on the whole row.
          // data-no-dnd: a long-press here should extend/complete the swipe
          // reveal, not lift the row for reorder — the two gestures would
          // otherwise compete for the same touchstart.
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

      {isMobile && (
        <Sheet
          open={editing}
          onClose={() => onRenameCancel(list)}
          aria-label={`Edit "${list.title}"`}
          title="Edit list"
        >
          <div className={styles.renameSheet}>
            <div className={styles.renameSheetBody}>
              <label className={styles.renameSheetLabel} htmlFor={`rename-${list.id}`}>
                List name
              </label>
              <input
                id={`rename-${list.id}`}
                ref={renameInputRef}
                className={styles.renameSheetInput}
                value={editTitle}
                onChange={(e) => onEditTitleChange(e.target.value)}
                onKeyDown={(e) => {
                  renameSheetCommitHandlers.onKeyDown(e);
                  if (e.key === 'Escape') onRenameCancel(list);
                }}
                onBlur={renameSheetCommitHandlers.onBlur}
              />
              <span className={styles.renameSheetLabel}>Colour</span>
              <ColorSwatches list={list} onColor={onColor} showLabels />
            </div>
            <div className={styles.renameSheetFooter}>
              <Button
                variant="primary"
                className={styles.renameSheetSaveBtn}
                onClick={() => onRenameCommit(list)}
              >
                Save
              </Button>
            </div>
          </div>
        </Sheet>
      )}
    </li>
  );
}
