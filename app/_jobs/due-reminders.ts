import { sdk, type ScheduleContext } from '@sovereignfs/sdk';
import { and, eq, inArray, isNotNull, isNull, lt, lte, or } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { tasksItems, tasksLists, tasksNotificationPrefs } from '../_db/schema';
import { digestSummary, isDigestDue } from '../_lib/notify';
import { localNowParts } from '../_lib/tz';

/**
 * Due/overdue notification schedule (manifest `schedules` entry
 * `due-reminders`, invoked every minute by the platform scheduler —
 * RFC 0046 Phase 1).
 *
 * Two notification kinds per opted-in user (tasks_notification_prefs,
 * enabled = true), both computed in the user's own stored IANA timezone:
 *
 * 1. **Morning digest** — once per local day, at/after the user's chosen
 *    morning_time: one notification summarising tasks due today and overdue.
 * 2. **Due-time reminder** — one notification per task whose due_time has
 *    arrived today.
 *
 * The scheduler gives no delivery guarantees (in-memory tick, restarts
 *  re-arm, replicas tick independently), so every send is gated behind a
 * conditional-UPDATE claim: last_digest_date on the prefs row for the digest,
 * reminder_sent_at on the task row for reminders. Only the invocation whose
 * UPDATE actually claimed the row sends — duplicate ticks lose the claim and
 * skip. A task's claim re-arms when its due date/time changes
 * (actions.ts setDueDate clears reminder_sent_at).
 *
 * Late-boot semantics: an instance that was down at a task's due time sends
 * the reminder on the next tick of the same local day; a due time missed by a
 * whole day is not retro-notified individually — it surfaces as overdue in
 * the next morning digest.
 */

// Same dialect cast as actions.ts — the platform default dialect is SQLite,
// and the SQLite-typed builders work against either backing driver.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;

function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

async function ownedListIds(db: Db, tenantId: string, userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: tasksLists.id })
    .from(tasksLists)
    .where(and(eq(tasksLists.tenantId, tenantId), eq(tasksLists.ownerId, userId)));
  return rows.map((r) => r.id);
}

async function sendMorningDigest(
  db: Db,
  ctx: ScheduleContext,
  pref: { tenantId: string; userId: string; lastDigestDate: string | null },
  listIds: string[],
  today: string,
): Promise<void> {
  // Claim BEFORE counting: exactly one invocation per local day wins this
  // UPDATE (the where repeats the staleness check the caller already made,
  // against current DB state), so concurrent ticks/replicas can't double-send.
  const claimed = await db
    .update(tasksNotificationPrefs)
    .set({ lastDigestDate: today, updatedAt: epochSeconds() })
    .where(
      and(
        eq(tasksNotificationPrefs.tenantId, pref.tenantId),
        eq(tasksNotificationPrefs.userId, pref.userId),
        or(
          isNull(tasksNotificationPrefs.lastDigestDate),
          lt(tasksNotificationPrefs.lastDigestDate, today),
        ),
      ),
    )
    .returning({ userId: tasksNotificationPrefs.userId });
  if (claimed.length === 0) return;

  // Top-level incomplete tasks with a due date up to today — one read, split
  // into due-today vs overdue in memory. Subtasks carry no due dates.
  const rows = await db
    .select({ dueDate: tasksItems.dueDate })
    .from(tasksItems)
    .where(
      and(
        eq(tasksItems.tenantId, pref.tenantId),
        inArray(tasksItems.listId, listIds),
        isNull(tasksItems.parentId),
        isNull(tasksItems.completedAt),
        isNotNull(tasksItems.dueDate),
        lte(tasksItems.dueDate, today),
      ),
    );
  const dueToday = rows.filter((r) => r.dueDate === today).length;
  const overdue = rows.length - dueToday;

  const summary = digestSummary(dueToday, overdue);
  if (summary === null) return; // nothing due — claim still consumed, quiet day

  await sdk.notifications.send(
    // Deep-links into Today's Agenda (TSK-30) rather than bare /tasks —
    // this notification is itself a summary of exactly the due-today/
    // overdue tasks that view surfaces, so it should land the user right on
    // the swipeable triage stack, not the lists index.
    { recipientUserId: pref.userId, title: summary, url: '/tasks/today' },
    ctx.headers,
  );
}

async function sendDueTimeReminders(
  db: Db,
  ctx: ScheduleContext,
  pref: { tenantId: string; userId: string },
  listIds: string[],
  today: string,
  nowTime: string,
): Promise<void> {
  const due = await db
    .select({
      id: tasksItems.id,
      listId: tasksItems.listId,
      title: tasksItems.title,
      dueTime: tasksItems.dueTime,
    })
    .from(tasksItems)
    .where(
      and(
        eq(tasksItems.tenantId, pref.tenantId),
        inArray(tasksItems.listId, listIds),
        isNull(tasksItems.completedAt),
        isNull(tasksItems.reminderSentAt),
        eq(tasksItems.dueDate, today),
        isNotNull(tasksItems.dueTime),
        lte(tasksItems.dueTime, nowTime),
      ),
    );

  for (const task of due) {
    // Per-task claim — the select above is only a candidate list; the UPDATE
    // is what wins the right to send (and re-checks completion).
    const claimed = await db
      .update(tasksItems)
      .set({ reminderSentAt: epochSeconds() })
      .where(
        and(
          eq(tasksItems.id, task.id),
          eq(tasksItems.tenantId, pref.tenantId),
          isNull(tasksItems.reminderSentAt),
          isNull(tasksItems.completedAt),
        ),
      )
      .returning({ id: tasksItems.id });
    if (claimed.length === 0) continue;

    await sdk.notifications.send(
      {
        recipientUserId: pref.userId,
        title: task.title,
        body: `Due at ${task.dueTime ?? ''}`,
        url: `/tasks/${task.listId}?task=${task.id}`,
      },
      ctx.headers,
    );
  }
}

export default async function dueReminders(ctx: ScheduleContext): Promise<void> {
  const db = (await sdk.db.getClient()) as Db;

  const prefs = await db
    .select()
    .from(tasksNotificationPrefs)
    .where(eq(tasksNotificationPrefs.enabled, true));

  for (const pref of prefs) {
    // Per-user containment: one user's failure (e.g. a DB hiccup mid-loop)
    // must not starve every later user on this tick. The scheduler logs
    // nothing per-user; rethrowing would abort the whole loop.
    try {
      const { date: today, time: nowTime } = localNowParts(pref.timezone, Date.now());
      const listIds = await ownedListIds(db, pref.tenantId, pref.userId);
      if (listIds.length === 0) continue;

      if (isDigestDue(nowTime, pref.morningTime, pref.lastDigestDate, today)) {
        await sendMorningDigest(db, ctx, pref, listIds, today);
      }
      await sendDueTimeReminders(db, ctx, pref, listIds, today, nowTime);
    } catch (err) {
      console.error('[tasks] due-reminders failed for user', pref.userId, err);
    }
  }
}
