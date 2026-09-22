'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  EmptyState,
  SwipeStack,
  SwipeStackCard,
  useToast,
  type SwipeDirection,
} from '@sovereignfs/ui';
import { AgendaCard } from '../_components/AgendaCard';
import { buildAgenda } from '../_lib/agenda';
import { deleteTask, setDueDate, toggleComplete } from '../_lib/actions';
import { addDaysISO, todayISO } from '../_lib/date';
import type { StarredTaskRow } from '../_lib/types';
import styles from './TodayAgendaView.module.css';

interface Props {
  tasks: StarredTaskRow[];
}

/**
 * Today's Agenda (TSK-30) — swipeable triage over `@sovereignfs/ui`'s
 * SwipeStack. The candidate set is classified/sorted once at mount
 * (buildAgenda, against the browser's own local calendar day); SwipeStack
 * then owns dismissing cards from view on its own, so this never needs to
 * recompute the stack mid-session — a swipe's server mutation lands in the
 * background and every other view (list panes, the morning digest count)
 * simply reflects it next time *they* fetch.
 */
export default function TodayAgendaView({ tasks }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [entries] = useState(() => buildAgenda(tasks, todayISO()));

  function handleSwipe(direction: SwipeDirection, cardId: string) {
    const entry = entries.find((e) => e.task.id === cardId);
    if (!entry) return;
    const { task } = entry;

    startTransition(async () => {
      try {
        switch (direction) {
          case 'up':
            // Done — reuses the existing completion path unmodified, so a
            // recurring task still spawns its next occurrence.
            await toggleComplete(task.id, task.listId, true);
            break;
          case 'down':
            // Cancel — deletes outright. SwipeStack has already committed
            // to the fling-out animation by the time onSwipe fires, so
            // there's no point in the gesture to insert a confirmation;
            // this is a deliberate, accepted tradeoff for this view.
            await deleteTask(task.id, task.listId);
            break;
          case 'left':
            // Snooze — push to tomorrow, this occurrence only (never the
            // whole recurring series).
            await setDueDate(task.id, task.listId, addDaysISO(1), task.dueTime, 'this');
            break;
          case 'right':
            // Keep for today — bumps an overdue task's due date to today
            // (clearing its overdue status) and, for a starred task with
            // no due date, gives it one.
            await setDueDate(task.id, task.listId, todayISO(), task.dueTime, 'this');
            break;
        }
        router.refresh();
      } catch {
        toast.show({
          title: 'Something went wrong',
          message: `Couldn't update "${task.title}" — try again from its list.`,
          category: 'error',
        });
      }
    });
  }

  if (entries.length === 0) {
    return (
      <div className={styles.wrap}>
        <div className={styles.header}>
          <h1 className={styles.heading}>Today</h1>
        </div>
        <EmptyState
          icon="circle-check"
          heading="All caught up"
          description="Nothing due today, overdue, or starred."
        />
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h1 className={styles.heading}>Today</h1>
        <span className={styles.count}>
          {entries.length} {entries.length === 1 ? 'task' : 'tasks'}
        </span>
      </div>
      <SwipeStack
        aria-label="Today's agenda"
        className={styles.stack}
        directions={{
          up: { label: 'Done', icon: 'check' },
          down: { label: 'Cancel', icon: 'trash-2' },
          left: { label: 'Snooze', icon: 'history' },
          right: { label: 'Keep', icon: 'calendar' },
        }}
        onSwipe={handleSwipe}
      >
        {entries.map(({ task, reason }) => (
          <SwipeStackCard key={task.id} cardId={task.id}>
            <AgendaCard task={task} reason={reason} />
          </SwipeStackCard>
        ))}
      </SwipeStack>
    </div>
  );
}
