'use client';

import { Checkbox, useCommitOnEnterOrBlur } from '@sovereignfs/ui';
import { useEffect, useRef, useState } from 'react';
import { createTask, deleteTask, getSubtasks, toggleComplete } from '../_lib/actions';
import styles from './SubtaskList.module.css';

interface Subtask {
  id: string;
  title: string;
  completedAt: number | null;
}

/**
 * Module-level cache, shared by every `SubtaskList` instance for the
 * lifetime of the page — keyed by parent task id, never evicted, same
 * "cache forever, no TTL" convention `MobileTasksCarousel`'s own per-list
 * `listState` cache already uses. `SubtaskList` is conditionally mounted by
 * its callers (`{expanded && <SubtaskList ... />}` in `TaskItem`), so every
 * collapse used to discard all fetched state and every re-expand repeated a
 * full `getSubtasks` round trip even when nothing had changed — this is
 * what makes that state survive across mount/unmount.
 *
 * `signature` reuses this component's own existing reload-trigger props
 * (`listId`/`parentCompletedAt`/`parentSubtaskCount`/`parentSubtaskDoneCount`
 * — see their doc comments below for why each one signals "subtasks may
 * have changed elsewhere") as the cache-staleness check: a cached entry is
 * only served when today's signature matches the signature recorded at
 * cache-write time. Anything that already forced a reload before this cache
 * existed still forces one now — this only removes the *redundant* reload
 * on a plain expand/collapse toggle where nothing in the signature moved.
 */
const subtaskCache = new Map<string, { subtasks: Subtask[]; signature: string }>();

function cacheSignature(
  listId: string,
  parentCompletedAt: number | null,
  parentSubtaskCount: number | undefined,
  parentSubtaskDoneCount: number | undefined,
): string {
  return `${listId}:${parentCompletedAt}:${parentSubtaskCount}:${parentSubtaskDoneCount}`;
}

interface Props {
  parentId: string;
  listId: string;
  showCompleted: boolean;
  // Parent's completedAt — changes when the parent is completed/reopened, which
  // cascade-updates subtasks server-side. Used purely as a reload trigger so an
  // already-expanded list reflects the cascade without a manual re-expand.
  parentCompletedAt: number | null;
  // Reload triggers only — same idea as parentCompletedAt above. This
  // component keeps its own independent subtasks state (useState/useEffect),
  // so when it's used inline under a task row (TaskItem) alongside a SEPARATE
  // SubtaskList instance in the detail pane, mutating subtasks via one
  // instance doesn't tell the other to refetch (neither parentId, listId, nor
  // parentCompletedAt change just because a subtask was added/toggled
  // elsewhere). Passing the parent row's own subtaskCount/subtaskDoneCount —
  // already re-fetched fresh by getTasks on every router.refresh() — closes
  // that gap. Left undefined by the detail pane, which stays in sync via its
  // own mutations already.
  parentSubtaskCount?: number;
  parentSubtaskDoneCount?: number;
  onMutated: () => void;
  /** Shows a "Subtasks · n/m" label above the rows. Off by default — the
   *  inline usage under a task row (TaskItem) already has the progress ring
   *  + chevron conveying the count, so a second label there would be
   *  redundant. The detail pane (no such indicator nearby) turns it on. */
  showLabel?: boolean;
  /** Renders each subtask as a bordered card rather than a flat row. Off by
   *  default so the compact inline usage under a task row is unaffected —
   *  only the detail pane (matching its notes/due-date/list boxes) opts in. */
  boxedRows?: boolean;
}

export default function SubtaskList({
  parentId,
  listId,
  showCompleted,
  parentCompletedAt,
  parentSubtaskCount,
  parentSubtaskDoneCount,
  onMutated,
  showLabel = false,
  boxedRows = false,
}: Props) {
  const currentSignature = cacheSignature(
    listId,
    parentCompletedAt,
    parentSubtaskCount,
    parentSubtaskDoneCount,
  );
  // Lazy initializer so a cache hit renders the real rows on the very first
  // frame instead of a brief empty flash before the effect below runs.
  const [subtasks, setSubtasks] = useState<Subtask[]>(() => {
    const cached = subtaskCache.get(parentId);
    return cached && cached.signature === currentSignature ? cached.subtasks : [];
  });
  const [newTitle, setNewTitle] = useState('');
  const [adding, setAdding] = useState(false);
  const addInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) addInputRef.current?.focus();
  }, [adding]);

  async function load(signature: string) {
    const rows = (await getSubtasks(parentId, listId)) as Subtask[];
    setSubtasks(rows);
    subtaskCache.set(parentId, { subtasks: rows, signature });
  }

  // Reload whenever the parent's completion changes (cascade), or whenever
  // the parent row's own subtask counts change (a mutation via a sibling
  // SubtaskList instance elsewhere on the page — see the prop docs above) —
  // both already forced a reload before the cache existed, and still do:
  // either one changes currentSignature, which a cached entry from before
  // that change can no longer match. Only a signature-preserving
  // mount/unmount (a plain expand/collapse toggle) now serves from cache
  // instead of refetching.
  useEffect(() => {
    const signature = cacheSignature(
      listId,
      parentCompletedAt,
      parentSubtaskCount,
      parentSubtaskDoneCount,
    );
    const cached = subtaskCache.get(parentId);
    if (cached && cached.signature === signature) {
      setSubtasks(cached.subtasks);
      return;
    }
    load(signature);
  }, [parentId, listId, parentCompletedAt, parentSubtaskCount, parentSubtaskDoneCount]);

  const visible = showCompleted ? subtasks : subtasks.filter((s) => s.completedAt === null);
  const doneCount = subtasks.filter((s) => s.completedAt !== null).length;

  async function handleToggle(id: string, checked: boolean) {
    // Same complaint as the main task checkbox: waiting on toggleComplete +
    // reload before flipping the box reads as an unresponsive/missed tap on
    // mobile. subtasks is plain local state (not derived from a prop), so a
    // direct optimistic patch is enough — load() below overwrites it with
    // the authoritative row once the round trip actually completes.
    setSubtasks((prev) =>
      prev.map((s) =>
        s.id === id ? { ...s, completedAt: checked ? Math.floor(Date.now() / 1000) : null } : s,
      ),
    );
    await toggleComplete(id, listId, checked);
    await load(currentSignature);
    onMutated();
  }

  async function handleDelete(id: string) {
    await deleteTask(id, listId);
    await load(currentSignature);
    onMutated();
  }

  async function handleAdd() {
    const trimmed = newTitle.trim();
    if (!trimmed) return;
    await createTask(listId, trimmed, parentId);
    setNewTitle('');
    setAdding(false);
    await load(currentSignature);
    onMutated();
  }

  // Losing focus for any reason (including iOS's native keyboard-accessory
  // Done/checkmark, which fires a blur but no keydown) commits the same as
  // Enter — see the hook's own doc comment. handleAdd already no-ops on an
  // empty title, so this is always safe to call.
  const commitHandlers = useCommitOnEnterOrBlur(handleAdd);

  return (
    <div className={[styles.root, boxedRows ? styles.rootBoxed : ''].filter(Boolean).join(' ')}>
      {showLabel && (
        <span className={styles.sectionLabel}>
          Subtasks{subtasks.length > 0 ? ` · ${doneCount}/${subtasks.length}` : ''}
        </span>
      )}
      {visible.map((s) => (
        <div
          key={s.id}
          className={[styles.row, boxedRows ? styles.rowBoxed : ''].filter(Boolean).join(' ')}
        >
          <Checkbox
            checked={s.completedAt !== null}
            onChange={(checked) => handleToggle(s.id, checked)}
            label={s.title}
            strikeThrough
          />
          <button
            type="button"
            className={styles.deleteBtn}
            aria-label="Delete subtask"
            onClick={() => handleDelete(s.id)}
          >
            ✕
          </button>
        </div>
      ))}

      {adding ? (
        <div className={styles.addRow}>
          <input
            ref={addInputRef}
            className={styles.addInput}
            placeholder="Subtask title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              commitHandlers.onKeyDown(e);
              if (e.key === 'Escape') {
                setNewTitle('');
                setAdding(false);
              }
            }}
            onBlur={() => {
              commitHandlers.onBlur();
              if (!newTitle.trim()) setAdding(false);
            }}
          />
        </div>
      ) : (
        <button type="button" className={styles.addBtn} onClick={() => setAdding(true)}>
          + Add subtask
        </button>
      )}
    </div>
  );
}
