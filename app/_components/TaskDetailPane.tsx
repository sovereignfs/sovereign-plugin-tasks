'use client';

import { Button, Checkbox, EmptyState, Icon } from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useLayoutEffect, useOptimistic, useRef, useState, useTransition } from 'react';
import { deleteTask, setRecurrenceRule, toggleComplete, updateTask } from '../_lib/actions';
import DueDateControl from './DueDateControl';
import ListPickerControl from './ListPickerControl';
import RecurrenceEditor from './RecurrenceEditor';
import StarButton from './StarButton';
import SubtaskList from './SubtaskList';
import styles from './TaskDetailPane.module.css';
import { useEditScope } from './useEditScope';

export interface DetailTask {
  id: string;
  listId: string;
  parentId: string | null;
  title: string;
  notes: string | null;
  completedAt: number | null;
  favorite: boolean;
  dueDate: string | null;
  dueTime: string | null;
  recurrenceRule: string | null;
  seriesId: string | null;
}

interface ListOption {
  id: string;
  title: string;
  color: string | null;
}

export default function TaskDetailPane({
  task,
  listId,
  lists,
  onFieldPatch,
}: {
  task: DetailTask | null;
  listId: string;
  lists: ListOption[];
  /**
   * Called synchronously with a partial update the moment an optimistic
   * toggle (completion, star) fires here — see StarButton's
   * onOptimisticChange doc comment for why this is needed. Only meaningful
   * on mobile, where MobileTasksCarousel passes its own detailTask patcher;
   * desktop's page.tsx doesn't provide one since router.refresh() there
   * already re-renders this pane with fresh server props within the same
   * transition.
   */
  onFieldPatch?: (patch: Partial<DetailTask>) => void;
}) {
  if (!task) {
    return (
      <div className={styles.emptyWrap}>
        <EmptyState
          icon="eye"
          heading="No task selected"
          description="Click a task to view notes and details."
        />
      </div>
    );
  }
  // Key by id so switching tasks re-initialises the edit buffers.
  return (
    <DetailBody key={task.id} task={task} listId={listId} lists={lists} onFieldPatch={onFieldPatch} />
  );
}

function DetailBody({
  task,
  listId,
  lists,
  onFieldPatch,
}: {
  task: DetailTask;
  listId: string;
  lists: ListOption[];
  onFieldPatch?: (patch: Partial<DetailTask>) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  // `key={task.id}` (TaskDetailPane above) only re-initialises these buffers
  // when the user switches to a *different* task — it does nothing when this
  // same task's own `task` prop is later replaced with fresher data, which
  // happens whenever the caller briefly renders an optimistic stand-in (built
  // from the list-level cache, which can itself be a few minutes stale on a
  // cold mobile load — see listCache.ts's COLD_START_STALE_AFTER_MS) before
  // the real getTask() fetch resolves. Without this effect, title/notes stay
  // stuck on whatever the optimistic snapshot had at mount, even after the
  // real value arrives, since useState's initializer only ever runs once.
  // Re-syncs whenever the server-derived value actually changes; harmless if
  // it fires while the user's own edit already matches (same value in, same
  // value out).
  useEffect(() => {
    setTitle(task.title);
  }, [task.title]);
  useEffect(() => {
    setNotes(task.notes ?? '');
  }, [task.notes]);
  // Optimistic completion — same reasoning as TaskItem's checkbox: flip
  // instantly instead of waiting on the toggleComplete round trip. onFieldPatch
  // keeps mobile's detailTask cache in sync so the optimistic value doesn't
  // revert once this transition settles (see StarButton's doc comment).
  const [isComplete, setOptimisticComplete] = useOptimistic(
    task.completedAt !== null,
    (_prev: boolean, next: boolean) => next,
  );
  const [, startTransition] = useTransition();
  const { requestScope, dialog: editScopeDialog } = useEditScope(task.seriesId);
  const titleRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grows the title textarea to fit its content (no drag handle, unlike
  // Notes below it — a header shouldn't have a manual-resize affordance).
  // Standard technique: reset to 'auto' first so shrinking (deleting text)
  // is measured correctly, then set to the resulting scrollHeight. Runs
  // before paint (useLayoutEffect) so there's no visible height jump.
  useLayoutEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    function resize() {
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }
    resize();
    // Re-measure once web fonts finish loading. The runtime shell loads
    // Hanken Grotesk via next/font with display: 'swap' — a fresh navigation
    // can run this effect's first measurement against the fallback font
    // (different line-height/character width), then the font swaps in
    // afterward with no re-render to trigger this effect again (title hasn't
    // changed). Without this, the fixed height stays sized to the fallback
    // font's line count, and the re-rendered text — now taller — overflows
    // its own textarea, overlapping the Notes section below it.
    if (typeof document !== 'undefined' && document.fonts) {
      void document.fonts.ready.then(resize);
    }
  }, [title]);

  const closeHref = `/tasks/${listId}`;

  function commitTitle() {
    const t = title.trim();
    if (t && t !== task.title) {
      requestScope((scope) => {
        startTransition(async () => {
          await updateTask(task.id, task.listId, { title: t }, scope);
          router.refresh();
        });
      });
    } else if (!t) {
      setTitle(task.title);
    }
  }

  function commitNotes() {
    const n = notes.trim();
    if (n !== (task.notes ?? '')) {
      requestScope((scope) => {
        startTransition(async () => {
          await updateTask(task.id, task.listId, { notes: n || undefined }, scope);
          router.refresh();
        });
      });
    }
  }

  function commitRecurrence(rule: string | null, scope: 'this' | 'future' | 'all') {
    startTransition(async () => {
      await setRecurrenceRule(task.id, task.listId, rule, scope);
      router.refresh();
    });
  }

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      setOptimisticComplete(checked);
      onFieldPatch?.({ completedAt: checked ? Math.floor(Date.now() / 1000) : null });
      await toggleComplete(task.id, task.listId, checked);
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteTask(task.id, task.listId);
      router.replace(closeHref);
      router.refresh();
    });
  }

  return (
    // suppressHydrationWarning: password-manager extensions (e.g. ProtonPass)
    // inject data-* attributes (data-protonpass-form) onto this container before
    // React hydrates, causing a benign server/client attribute mismatch. This
    // suppresses only this element's attribute diff, not its children.
    <div className={styles.body} suppressHydrationWarning>
      <div className={styles.top}>
        <Checkbox
          checked={isComplete}
          onChange={handleToggle}
          label=""
          aria-label={`Mark "${task.title}" ${isComplete ? 'incomplete' : 'complete'}`}
        />
        <textarea
          ref={titleRef}
          className={[styles.title, isComplete ? styles.complete : ''].filter(Boolean).join(' ')}
          value={title}
          rows={1}
          aria-label="Task title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            // Unlike Notes, title never allows an inserted newline — even
            // though the box can now wrap across multiple lines, it's
            // conceptually still one continuous string, not multi-paragraph
            // content. Enter always saves regardless of Shift.
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLTextAreaElement).blur();
            }
            if (e.key === 'Escape') {
              setTitle(task.title);
              (e.target as HTMLTextAreaElement).blur();
            }
          }}
        />
        <StarButton
          taskId={task.id}
          listId={task.listId}
          favorite={task.favorite}
          onOptimisticChange={(next) => onFieldPatch?.({ favorite: next })}
          className={styles.star}
        />
        <button
          type="button"
          className={styles.close}
          aria-label="Close details"
          onClick={() => router.replace(closeHref, { scroll: false })}
        >
          ✕
        </button>
      </div>

      <label className={styles.sectionLabel} htmlFor="task-notes">
        Notes
      </label>
      <textarea
        id="task-notes"
        className={styles.notes}
        value={notes}
        placeholder="Add notes…"
        rows={4}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={commitNotes}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            (e.target as HTMLTextAreaElement).blur();
          }
          if (e.key === 'Escape') {
            setNotes(task.notes ?? '');
            (e.target as HTMLTextAreaElement).blur();
          }
        }}
      />

      <span className={styles.sectionLabel}>Due date</span>
      <DueDateControl
        taskId={task.id}
        listId={task.listId}
        dueDate={task.dueDate}
        dueTime={task.dueTime}
        completedAt={task.completedAt}
        requestScope={requestScope}
      />

      {task.parentId === null && (
        <>
          <span className={styles.sectionLabel}>Repeat</span>
          <RecurrenceEditor
            rule={task.recurrenceRule}
            dueDate={task.dueDate}
            onCommit={commitRecurrence}
            requestScope={requestScope}
          />
        </>
      )}

      {task.parentId === null && (
        <SubtaskList
          parentId={task.id}
          listId={task.listId}
          showCompleted
          parentCompletedAt={task.completedAt}
          onMutated={() => router.refresh()}
          showLabel
          boxedRows
        />
      )}

      {task.parentId === null && (
        <>
          <span className={styles.sectionLabel}>List</span>
          <ListPickerControl taskId={task.id} currentListId={task.listId} lists={lists} />
        </>
      )}

      <Button variant="destructive" className={styles.delete} onClick={handleDelete}>
        <Icon name="trash-2" size="sm" aria-hidden />
        Delete task
      </Button>

      {editScopeDialog}
    </div>
  );
}
