/**
 * Pure classification/ordering for Today's Agenda (TSK-30) — kept IO-free,
 * like notify.ts's digest helpers, so the "which tasks earn a card, in what
 * order" decision is unit-testable without a database or a real clock.
 *
 * `today` is always passed in (an ISO 'YYYY-MM-DD' string, from date.ts's
 * todayISO()) rather than read internally — this runs live in the viewer's
 * own browser, not a scheduled job with a stored timezone to honor, so the
 * caller's own local calendar day is the only one that matters. Contrast
 * app/_jobs/due-reminders.ts, which *is* exactly that kind of job and
 * rightly uses tz.ts instead of this file or date.ts.
 */

import type { StarredTaskRow } from './types';

export type AgendaReason = 'overdue' | 'dueToday' | 'starred';

export interface AgendaEntry {
  task: StarredTaskRow;
  reason: AgendaReason;
}

/**
 * Which bucket (if any) one candidate task earns a card for today.
 * Precedence overdue > dueToday > starred — a task can match more than one
 * (a starred task that's also overdue), but only ever gets one card.
 * Candidates are assumed already filtered to top-level/incomplete
 * (getAgendaTasks does this server-side); completedAt is still checked here
 * so this function is safe to call on an unfiltered list too.
 */
export function classifyAgendaTask(task: StarredTaskRow, today: string): AgendaReason | null {
  if (task.completedAt !== null) return null;
  if (task.dueDate !== null) {
    if (task.dueDate < today) return 'overdue';
    if (task.dueDate === today) return 'dueToday';
  }
  return task.favorite ? 'starred' : null;
}

/**
 * Classifies every candidate and sorts into the stack order: overdue
 * (oldest due date first) → due-today (earliest due time first, no-time
 * last) → starred-only (title, for a stable order — there's no due date to
 * sort by). Tasks that don't qualify today (classifyAgendaTask returns
 * null) are dropped.
 */
export function buildAgenda(tasks: StarredTaskRow[], today: string): AgendaEntry[] {
  const entries: AgendaEntry[] = [];
  for (const task of tasks) {
    const reason = classifyAgendaTask(task, today);
    if (reason) entries.push({ task, reason });
  }

  const rank: Record<AgendaReason, number> = { overdue: 0, dueToday: 1, starred: 2 };
  return entries.sort((a, b) => {
    if (rank[a.reason] !== rank[b.reason]) return rank[a.reason] - rank[b.reason];
    switch (a.reason) {
      case 'overdue':
        return (a.task.dueDate ?? '').localeCompare(b.task.dueDate ?? '');
      case 'dueToday':
        // Nulls (a due-today task with no specific time) sort last.
        return (a.task.dueTime ?? '￿').localeCompare(b.task.dueTime ?? '￿');
      case 'starred':
        return a.task.title.localeCompare(b.task.title);
    }
  });
}
