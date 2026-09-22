import { formatDueDate } from '../_lib/date';
import { listDotColor } from '../_lib/colors';
import type { AgendaReason } from '../_lib/agenda';
import type { StarredTaskRow } from '../_lib/types';
import styles from './AgendaCard.module.css';

export interface AgendaCardProps {
  task: StarredTaskRow;
  reason: AgendaReason;
}

function reasonLabel(task: StarredTaskRow, reason: AgendaReason): string {
  switch (reason) {
    case 'overdue':
      return `Overdue · ${formatDueDate(task.dueDate)}`;
    case 'dueToday':
      return task.dueTime ? `Due today · ${task.dueTime}` : 'Due today';
    case 'starred':
      return 'Starred';
  }
}

/**
 * Presentational card body for one SwipeStackCard in Today's Agenda
 * (TSK-30) — title, source-list badge, and why this task earned a spot
 * (overdue/due-today/starred). No interaction of its own; SwipeStack owns
 * the drag/commit gesture around it, so this only ever renders — no click
 * handlers, matching v1's scope (tapping through to the task's own detail
 * pane is a later enhancement, not built here).
 */
export function AgendaCard({ task, reason }: AgendaCardProps) {
  const reasonRowClassName = [styles.reasonRow, reason === 'overdue' ? styles.reasonOverdue : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={styles.card}>
      <div className={reasonRowClassName}>
        {/* Plain glyph, not an Icon — matches StarButton's own convention;
            no 'star' icon exists in the design system yet. */}
        {reason === 'starred' && <span aria-hidden>★</span>}
        <span>{reasonLabel(task, reason)}</span>
      </div>
      <h2 className={styles.title}>{task.title}</h2>
      {task.notes && <p className={styles.notes}>{task.notes}</p>}
      <div className={styles.listBadge}>
        <span
          className={styles.listDot}
          style={{ background: listDotColor(task.listColor) }}
          aria-hidden
        />
        <span>{task.listTitle}</span>
      </div>
      {task.subtaskCount > 0 && (
        <div className={styles.subtaskCount}>
          {task.subtaskDoneCount}/{task.subtaskCount} subtasks
        </div>
      )}
    </div>
  );
}
