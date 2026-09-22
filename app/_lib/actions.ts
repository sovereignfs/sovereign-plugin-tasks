'use server';

import { sdk } from '@sovereignfs/sdk';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, or } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { randomUUID } from 'node:crypto';
import {
  tasksItems,
  tasksLists,
  tasksNotificationPrefs,
  tasksUserListPrefs,
  tasksViews,
} from '../_db/schema';
import { isValidTimeZone } from './tz';
import { DEFAULT_LIST_COLOR } from './colors';
import { nextOccurrence } from './recurrence';

/** "this" edits a single row; "future"/"all" apply to the rest of a recurring
 *  series (TSK-24) — see applyToSeries below. */
type EditScope = 'this' | 'future' | 'all';

// DrizzleClient is typed as `unknown` in the SDK (dialect-agnostic contract).
// We cast to the SQLite type here since the platform default dialect is SQLite.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;

function now() {
  return Math.floor(Date.now() / 1000);
}

async function getContext() {
  const session = await sdk.auth.requireSession();
  const db = (await sdk.db.getClient()) as Db;
  return { session, db, userId: session.user.id, tenantId: session.user.tenantId };
}

// ── Lists ──────────────────────────────────────────────────────────────────

export async function getLists() {
  const { db, userId, tenantId } = await getContext();
  const lists = await db
    .select()
    .from(tasksLists)
    .where(and(eq(tasksLists.tenantId, tenantId), eq(tasksLists.ownerId, userId)))
    .orderBy(asc(tasksLists.sortOrder), asc(tasksLists.createdAt));

  // Open-task count per list (top-level, incomplete) in one read. Rows for
  // lists the user doesn't own are simply never looked up in the map below.
  const openRows = await db
    .select({ listId: tasksItems.listId })
    .from(tasksItems)
    .where(
      and(
        eq(tasksItems.tenantId, tenantId),
        isNull(tasksItems.parentId),
        isNull(tasksItems.completedAt),
      ),
    );
  const counts = new Map<string, number>();
  for (const r of openRows) counts.set(r.listId, (counts.get(r.listId) ?? 0) + 1);

  return lists.map((l) => ({ ...l, openCount: counts.get(l.id) ?? 0 }));
}

export async function createList(title: string) {
  const { db, userId, tenantId } = await getContext();
  const existing = await getLists();
  const maxOrder = existing.reduce((m, l) => Math.max(m, l.sortOrder), -1);
  const id = randomUUID();
  const ts = now();

  await db.insert(tasksLists).values({
    id,
    tenantId,
    ownerId: userId,
    title: title.trim(),
    // Colour is mandatory (not a nullable "no colour" state) — every new list
    // gets the default swatch; the picker never needs a clear option.
    color: DEFAULT_LIST_COLOR,
    sortOrder: maxOrder + 1,
    createdAt: ts,
    updatedAt: ts,
  });

  // Create default list view
  await db.insert(tasksViews).values({
    id: randomUUID(),
    tenantId,
    listId: id,
    ownerId: userId,
    name: 'List',
    kind: 'list',
    isDefault: true,
    sortOrder: 0,
    createdAt: ts,
    updatedAt: ts,
  });

  return id;
}

export async function reorderLists(orderedIds: string[]) {
  const { db, userId, tenantId } = await getContext();
  const ts = now();
  await Promise.all(
    orderedIds.map((id, index) =>
      db
        .update(tasksLists)
        .set({ sortOrder: index, updatedAt: ts })
        .where(
          and(
            eq(tasksLists.id, id),
            eq(tasksLists.tenantId, tenantId),
            eq(tasksLists.ownerId, userId),
          ),
        ),
    ),
  );
}

export async function updateList(listId: string, title: string) {
  const { db, userId, tenantId } = await getContext();
  await db
    .update(tasksLists)
    .set({ title: title.trim(), updatedAt: now() })
    .where(
      and(
        eq(tasksLists.id, listId),
        eq(tasksLists.tenantId, tenantId),
        eq(tasksLists.ownerId, userId),
      ),
    );
}

export async function updateListColor(listId: string, color: string) {
  const { db, userId, tenantId } = await getContext();
  await db
    .update(tasksLists)
    .set({ color, updatedAt: now() })
    .where(
      and(
        eq(tasksLists.id, listId),
        eq(tasksLists.tenantId, tenantId),
        eq(tasksLists.ownerId, userId),
      ),
    );
}

export async function deleteList(listId: string) {
  const { db, userId, tenantId } = await getContext();
  // Verify ownership before cascade
  const owned = await db
    .select({ id: tasksLists.id })
    .from(tasksLists)
    .where(
      and(
        eq(tasksLists.id, listId),
        eq(tasksLists.tenantId, tenantId),
        eq(tasksLists.ownerId, userId),
      ),
    );
  if (!owned.length) return;

  // Hard delete — tasks, prefs, views cascade via app layer (no FK on SQLite enforced)
  await db
    .delete(tasksItems)
    .where(and(eq(tasksItems.listId, listId), eq(tasksItems.tenantId, tenantId)));
  await db
    .delete(tasksUserListPrefs)
    .where(and(eq(tasksUserListPrefs.listId, listId), eq(tasksUserListPrefs.tenantId, tenantId)));
  await db
    .delete(tasksViews)
    .where(and(eq(tasksViews.listId, listId), eq(tasksViews.tenantId, tenantId)));
  await db
    .delete(tasksLists)
    .where(and(eq(tasksLists.id, listId), eq(tasksLists.tenantId, tenantId)));
}

// ── Tasks ──────────────────────────────────────────────────────────────────

async function assertListOwnership(db: Db, listId: string, userId: string, tenantId: string) {
  const rows = await db
    .select({ id: tasksLists.id })
    .from(tasksLists)
    .where(
      and(
        eq(tasksLists.id, listId),
        eq(tasksLists.tenantId, tenantId),
        eq(tasksLists.ownerId, userId),
      ),
    );
  if (!rows.length) throw new Error('Not authorized');
}

/** Applies `patch` across a recurring series (TSK-24's "this and future
 *  instances" / "all instances"). "future" matches the spec's own wording —
 *  filter by series_id + due_date >= the edited task's own due_date. */
async function applyToSeries(
  db: Db,
  tenantId: string,
  seriesId: string,
  referenceDueDate: string | null,
  scope: Extract<EditScope, 'future' | 'all'>,
  patch: Record<string, unknown>,
) {
  const conditions = [eq(tasksItems.seriesId, seriesId), eq(tasksItems.tenantId, tenantId)];
  if (scope === 'future' && referenceDueDate) {
    conditions.push(gte(tasksItems.dueDate, referenceDueDate));
  }
  await db
    .update(tasksItems)
    .set({ ...patch, updatedAt: now() })
    .where(and(...conditions));
}

export async function getTasks(listId: string) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);

  // Top-level tasks, plus a single flat read of every subtask in the list so we
  // can attach per-parent counts without an N+1 fetch. Aggregation happens in
  // JS — a grouped SQL count would be dialect-specific and this list is small.
  const [top, subs] = await Promise.all([
    db
      .select()
      .from(tasksItems)
      .where(
        and(
          eq(tasksItems.listId, listId),
          eq(tasksItems.tenantId, tenantId),
          isNull(tasksItems.parentId),
        ),
      )
      .orderBy(asc(tasksItems.sortOrder), asc(tasksItems.createdAt)),
    db
      .select({ parentId: tasksItems.parentId, completedAt: tasksItems.completedAt })
      .from(tasksItems)
      .where(
        and(
          eq(tasksItems.listId, listId),
          eq(tasksItems.tenantId, tenantId),
          isNotNull(tasksItems.parentId),
        ),
      ),
  ]);

  const counts = new Map<string, { total: number; done: number }>();
  for (const s of subs) {
    if (!s.parentId) continue;
    const c = counts.get(s.parentId) ?? { total: 0, done: 0 };
    c.total += 1;
    if (s.completedAt !== null) c.done += 1;
    counts.set(s.parentId, c);
  }

  return top.map((t) => ({
    ...t,
    subtaskCount: counts.get(t.id)?.total ?? 0,
    subtaskDoneCount: counts.get(t.id)?.done ?? 0,
  }));
}

/**
 * Every starred top-level task across every list the user owns, decorated
 * with the source list's title/colour (TSK-28's virtual "Starred" view).
 * Ordered by due date (nulls last), then creation time — matches the design
 * doc's stated order, distinct from a real list's manual/sort-by order since
 * there's no cross-list manual order to fall back on.
 */
export async function getStarredTasks() {
  const { db, userId, tenantId } = await getContext();

  const lists = await db
    .select({ id: tasksLists.id, title: tasksLists.title, color: tasksLists.color })
    .from(tasksLists)
    .where(and(eq(tasksLists.tenantId, tenantId), eq(tasksLists.ownerId, userId)));
  if (lists.length === 0) return [];
  const listMap = new Map(lists.map((l) => [l.id, l]));
  const listIds = [...listMap.keys()];

  const [top, subs] = await Promise.all([
    db
      .select()
      .from(tasksItems)
      .where(
        and(
          eq(tasksItems.tenantId, tenantId),
          eq(tasksItems.favorite, true),
          isNull(tasksItems.parentId),
          inArray(tasksItems.listId, listIds),
        ),
      ),
    db
      .select({ parentId: tasksItems.parentId, completedAt: tasksItems.completedAt })
      .from(tasksItems)
      .where(
        and(
          eq(tasksItems.tenantId, tenantId),
          isNotNull(tasksItems.parentId),
          inArray(tasksItems.listId, listIds),
        ),
      ),
  ]);

  const counts = new Map<string, { total: number; done: number }>();
  for (const s of subs) {
    if (!s.parentId) continue;
    const c = counts.get(s.parentId) ?? { total: 0, done: 0 };
    c.total += 1;
    if (s.completedAt !== null) c.done += 1;
    counts.set(s.parentId, c);
  }

  const decorated = top.map((t) => {
    const list = listMap.get(t.listId);
    return {
      ...t,
      subtaskCount: counts.get(t.id)?.total ?? 0,
      subtaskDoneCount: counts.get(t.id)?.done ?? 0,
      listTitle: list?.title ?? '',
      listColor: list?.color ?? null,
    };
  });

  decorated.sort((a, b) => {
    if (a.dueDate === null && b.dueDate === null) return a.createdAt - b.createdAt;
    if (a.dueDate === null) return 1;
    if (b.dueDate === null) return -1;
    if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    return a.createdAt - b.createdAt;
  });

  return decorated;
}

/** Count of active (incomplete) starred tasks — cheap enough to reuse
 *  getStarredTasks() rather than a separate query; the sidebar row needs it
 *  on every route, not just /tasks/starred itself. */
export async function countStarredTasks() {
  const tasks = await getStarredTasks();
  return tasks.filter((t) => t.completedAt === null).length;
}

/**
 * Every top-level, incomplete task across every list the user owns that
 * either has a due date or is starred — candidates for Today's Agenda
 * (TSK-30). Same decoration (listTitle/listColor) and subtask-count
 * aggregation as getStarredTasks(); no date-based filtering here — deciding
 * overdue/due-today/starred-only happens client-side in app/_lib/agenda.ts,
 * against the viewer's own local calendar day (see that file's own doc
 * comment for why a server-computed cutoff would be wrong here).
 */
export async function getAgendaTasks() {
  const { db, userId, tenantId } = await getContext();

  const lists = await db
    .select({ id: tasksLists.id, title: tasksLists.title, color: tasksLists.color })
    .from(tasksLists)
    .where(and(eq(tasksLists.tenantId, tenantId), eq(tasksLists.ownerId, userId)));
  if (lists.length === 0) return [];
  const listMap = new Map(lists.map((l) => [l.id, l]));
  const listIds = [...listMap.keys()];

  const [top, subs] = await Promise.all([
    db
      .select()
      .from(tasksItems)
      .where(
        and(
          eq(tasksItems.tenantId, tenantId),
          isNull(tasksItems.parentId),
          isNull(tasksItems.completedAt),
          inArray(tasksItems.listId, listIds),
          or(isNotNull(tasksItems.dueDate), eq(tasksItems.favorite, true)),
        ),
      ),
    db
      .select({ parentId: tasksItems.parentId, completedAt: tasksItems.completedAt })
      .from(tasksItems)
      .where(
        and(
          eq(tasksItems.tenantId, tenantId),
          isNotNull(tasksItems.parentId),
          inArray(tasksItems.listId, listIds),
        ),
      ),
  ]);

  const counts = new Map<string, { total: number; done: number }>();
  for (const s of subs) {
    if (!s.parentId) continue;
    const c = counts.get(s.parentId) ?? { total: 0, done: 0 };
    c.total += 1;
    if (s.completedAt !== null) c.done += 1;
    counts.set(s.parentId, c);
  }

  return top.map((t) => {
    const list = listMap.get(t.listId);
    return {
      ...t,
      subtaskCount: counts.get(t.id)?.total ?? 0,
      subtaskDoneCount: counts.get(t.id)?.done ?? 0,
      listTitle: list?.title ?? '',
      listColor: list?.color ?? null,
    };
  });
}

export async function getTask(taskId: string) {
  const { db, userId, tenantId } = await getContext();
  const rows = await db
    .select()
    .from(tasksItems)
    .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
  const task = rows[0];
  if (!task) return null;
  // Authorize via the owning list, not the item row (which has no owner_id).
  await assertListOwnership(db, task.listId, userId, tenantId);
  return task;
}

/** Cross-list search over task titles, scoped to the current user's lists. */
export async function searchTasks(query: string) {
  const { db, userId, tenantId } = await getContext();
  const q = query.trim();
  if (!q) return [];

  const lists = await db
    .select({ id: tasksLists.id, title: tasksLists.title })
    .from(tasksLists)
    .where(and(eq(tasksLists.tenantId, tenantId), eq(tasksLists.ownerId, userId)));
  const listTitles = new Map(lists.map((l) => [l.id, l.title]));
  if (listTitles.size === 0) return [];

  const items = await db
    .select()
    .from(tasksItems)
    .where(and(eq(tasksItems.tenantId, tenantId), like(tasksItems.title, `%${q}%`)))
    .orderBy(desc(tasksItems.updatedAt))
    .limit(50);

  // Keep only items in lists the user owns; attach the list title for grouping.
  return items
    .filter((it) => listTitles.has(it.listId))
    .map((it) => ({ ...it, listTitle: listTitles.get(it.listId) as string }));
}

export async function getSubtasks(parentId: string, listId: string) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);
  return db
    .select()
    .from(tasksItems)
    .where(and(eq(tasksItems.parentId, parentId), eq(tasksItems.tenantId, tenantId)))
    .orderBy(asc(tasksItems.sortOrder), asc(tasksItems.createdAt));
}

export async function createTask(listId: string, title: string, parentId?: string) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);

  const siblings = await db
    .select({ sortOrder: tasksItems.sortOrder })
    .from(tasksItems)
    .where(
      and(
        eq(tasksItems.listId, listId),
        eq(tasksItems.tenantId, tenantId),
        parentId ? eq(tasksItems.parentId, parentId) : isNull(tasksItems.parentId),
      ),
    );
  // New tasks go to the top of their sibling group — prepend, don't append.
  const minOrder = siblings.reduce((m, t) => Math.min(m, t.sortOrder), 0);
  const ts = now();

  const id = randomUUID();
  await db.insert(tasksItems).values({
    id,
    tenantId,
    listId,
    parentId: parentId ?? null,
    title: title.trim(),
    sortOrder: minOrder - 1,
    createdAt: ts,
    updatedAt: ts,
  });
  return id;
}

export async function updateTask(
  taskId: string,
  listId: string,
  patch: { title?: string; notes?: string },
  scope: EditScope = 'this',
) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);

  if (scope !== 'this') {
    const [task] = await db
      .select({ seriesId: tasksItems.seriesId, dueDate: tasksItems.dueDate })
      .from(tasksItems)
      .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
    if (task?.seriesId) {
      await applyToSeries(db, tenantId, task.seriesId, task.dueDate, scope, patch);
      return;
    }
    // Not actually part of a series (e.g. recurrence was cleared elsewhere) —
    // fall through to a single-row update below.
  }

  await db
    .update(tasksItems)
    .set({ ...patch, updatedAt: now() })
    .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
}

/** Reassigns a top-level task to a different list, appending it at the end
 *  (matching createTask's ordering). Subtasks move with their parent —
 *  otherwise they'd be orphaned in the old list (getSubtasks filters by both
 *  parentId and listId). */
export async function moveTask(taskId: string, fromListId: string, toListId: string) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, fromListId, userId, tenantId);
  await assertListOwnership(db, toListId, userId, tenantId);
  if (fromListId === toListId) return;

  const siblings = await db
    .select({ sortOrder: tasksItems.sortOrder })
    .from(tasksItems)
    .where(
      and(
        eq(tasksItems.listId, toListId),
        eq(tasksItems.tenantId, tenantId),
        isNull(tasksItems.parentId),
      ),
    );
  const maxOrder = siblings.reduce((m, t) => Math.max(m, t.sortOrder), -1);
  const ts = now();

  await db
    .update(tasksItems)
    .set({ listId: toListId, sortOrder: maxOrder + 1, updatedAt: ts })
    .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));

  await db
    .update(tasksItems)
    .set({ listId: toListId, updatedAt: ts })
    .where(and(eq(tasksItems.parentId, taskId), eq(tasksItems.tenantId, tenantId)));
}

export async function setDueDate(
  taskId: string,
  listId: string,
  dueDate: string | null,
  dueTime: string | null,
  scope: EditScope = 'this',
) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);

  if (scope !== 'this') {
    const [task] = await db
      .select({ seriesId: tasksItems.seriesId, dueDate: tasksItems.dueDate })
      .from(tasksItems)
      .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
    if (task?.seriesId) {
      // Every occurrence in a series has its own calendar date by design —
      // overwriting them all to this one literal dueDate would collapse the
      // whole series onto a single day. Only the time-of-day propagates
      // series-wide; the date itself only ever applies to this one instance.
      // reminderSentAt re-arms alongside every due change (here and below) so
      // the scheduler's due-time reminder fires again for the new time — see
      // app/_jobs/due-reminders.ts.
      await applyToSeries(db, tenantId, task.seriesId, task.dueDate, scope, {
        dueTime: dueDate ? dueTime : null,
        reminderSentAt: null,
      });
      await db
        .update(tasksItems)
        .set({
          dueDate,
          dueTime: dueDate ? dueTime : null,
          reminderSentAt: null,
          updatedAt: now(),
        })
        .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
      return;
    }
  }

  await db
    .update(tasksItems)
    // Due time is only meaningful with a due date; clear it when the date clears.
    .set({ dueDate, dueTime: dueDate ? dueTime : null, reminderSentAt: null, updatedAt: now() })
    .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
}

/** Sets or clears a task's recurrence pattern. Assigns a fresh seriesId the
 *  first time a task becomes recurring; clearing the rule (rule === null)
 *  detaches the task from its series entirely (seriesId cleared too). */
export async function setRecurrenceRule(
  taskId: string,
  listId: string,
  rule: string | null,
  scope: EditScope = 'this',
) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);

  const [task] = await db
    .select({ seriesId: tasksItems.seriesId, dueDate: tasksItems.dueDate })
    .from(tasksItems)
    .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));

  if (scope === 'this' || !task?.seriesId) {
    const seriesId = rule ? (task?.seriesId ?? randomUUID()) : null;
    await db
      .update(tasksItems)
      .set({ recurrenceRule: rule, seriesId, updatedAt: now() })
      .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
    return;
  }

  const patch: { recurrenceRule: string | null; seriesId?: null } = { recurrenceRule: rule };
  if (rule === null) patch.seriesId = null;
  await applyToSeries(db, tenantId, task.seriesId, task.dueDate, scope, patch);
}

export async function toggleFavorite(taskId: string, listId: string, favorite: boolean) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);
  await db
    .update(tasksItems)
    .set({ favorite, updatedAt: now() })
    .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
}

export async function toggleComplete(taskId: string, listId: string, complete: boolean) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);
  const ts = now();

  // When completing a parent task, also complete all subtasks
  if (complete) {
    await db
      .update(tasksItems)
      .set({ completedAt: ts, updatedAt: ts })
      .where(and(eq(tasksItems.parentId, taskId), eq(tasksItems.tenantId, tenantId)));
  }

  await db
    .update(tasksItems)
    .set({ completedAt: complete ? ts : null, updatedAt: ts })
    .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));

  if (complete) {
    await spawnNextOccurrenceIfRecurring(db, tenantId, taskId);
  }
}

/** Completing a recurring task inserts a new sibling for the next occurrence
 *  (same list/title/notes/assignee/recurrence_rule/series_id). The new
 *  instance starts with no subtasks — the spec's own wording for this
 *  mechanic ("same series_id, recurrence_rule, list, and assignee") doesn't
 *  mention subtasks, and carrying forward a partially-done checklist
 *  indefinitely is ambiguous. No-ops when the task isn't recurring, has no
 *  due date to anchor the next occurrence on, or the series has ended
 *  (UNTIL/COUNT exhausted). The just-completed row's own recurrenceRule/
 *  seriesId are left untouched — it stays a historical record of what it was. */
async function spawnNextOccurrenceIfRecurring(db: Db, tenantId: string, taskId: string) {
  const [task] = await db
    .select()
    .from(tasksItems)
    .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
  if (!task?.recurrenceRule || !task.dueDate) return;

  const next = nextOccurrence(task.recurrenceRule, task.dueDate);
  if (!next) return;

  const siblings = await db
    .select({ sortOrder: tasksItems.sortOrder })
    .from(tasksItems)
    .where(
      and(
        eq(tasksItems.listId, task.listId),
        eq(tasksItems.tenantId, tenantId),
        isNull(tasksItems.parentId),
      ),
    );
  const maxOrder = siblings.reduce((m, t) => Math.max(m, t.sortOrder), -1);
  const ts = now();

  await db.insert(tasksItems).values({
    id: randomUUID(),
    tenantId,
    listId: task.listId,
    parentId: null,
    assigneeId: task.assigneeId,
    title: task.title,
    notes: task.notes,
    dueDate: next,
    dueTime: task.dueTime,
    recurrenceRule: task.recurrenceRule,
    seriesId: task.seriesId,
    sortOrder: maxOrder + 1,
    createdAt: ts,
    updatedAt: ts,
  });
}

export async function deleteTask(taskId: string, listId: string) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);
  // Delete subtasks first
  await db
    .delete(tasksItems)
    .where(and(eq(tasksItems.parentId, taskId), eq(tasksItems.tenantId, tenantId)));
  await db
    .delete(tasksItems)
    .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
}

/** TSK-20: delete every task in taskIds plus their subtasks, in one round
 *  trip per table. All ids are assumed to belong to listId — callers source
 *  them from that list's own rendered rows. */
export async function bulkDeleteTasks(taskIds: string[], listId: string) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);
  if (taskIds.length === 0) return;
  await db
    .delete(tasksItems)
    .where(and(inArray(tasksItems.parentId, taskIds), eq(tasksItems.tenantId, tenantId)));
  await db
    .delete(tasksItems)
    .where(and(inArray(tasksItems.id, taskIds), eq(tasksItems.tenantId, tenantId)));
}

/** TSK-21: reassign every task in taskIds to toListId, appending each after
 *  the destination's existing tasks in taskIds' own order. Subtasks move with
 *  their parent, same as the single-task moveTask above. */
export async function bulkMoveTasks(taskIds: string[], fromListId: string, toListId: string) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, fromListId, userId, tenantId);
  await assertListOwnership(db, toListId, userId, tenantId);
  if (fromListId === toListId || taskIds.length === 0) return;

  const siblings = await db
    .select({ sortOrder: tasksItems.sortOrder })
    .from(tasksItems)
    .where(
      and(
        eq(tasksItems.listId, toListId),
        eq(tasksItems.tenantId, tenantId),
        isNull(tasksItems.parentId),
      ),
    );
  let maxOrder = siblings.reduce((m, t) => Math.max(m, t.sortOrder), -1);
  const ts = now();

  for (const taskId of taskIds) {
    maxOrder += 1;
    await db
      .update(tasksItems)
      .set({ listId: toListId, sortOrder: maxOrder, updatedAt: ts })
      .where(and(eq(tasksItems.id, taskId), eq(tasksItems.tenantId, tenantId)));
    await db
      .update(tasksItems)
      .set({ listId: toListId, updatedAt: ts })
      .where(and(eq(tasksItems.parentId, taskId), eq(tasksItems.tenantId, tenantId)));
  }
}

export async function reorderTasks(listId: string, orderedIds: string[]) {
  const { db, userId, tenantId } = await getContext();
  await assertListOwnership(db, listId, userId, tenantId);
  const ts = now();
  await Promise.all(
    orderedIds.map((id, index) =>
      db
        .update(tasksItems)
        .set({ sortOrder: index, updatedAt: ts })
        .where(and(eq(tasksItems.id, id), eq(tasksItems.tenantId, tenantId))),
    ),
  );
}

// ── Prefs ──────────────────────────────────────────────────────────────────

export async function getOrCreatePrefs(listId: string) {
  const { db, userId, tenantId } = await getContext();
  const rows = await db
    .select()
    .from(tasksUserListPrefs)
    .where(
      and(
        eq(tasksUserListPrefs.tenantId, tenantId),
        eq(tasksUserListPrefs.userId, userId),
        eq(tasksUserListPrefs.listId, listId),
      ),
    );
  if (rows.length) return rows[0];

  const ts = now();
  await db.insert(tasksUserListPrefs).values({
    tenantId,
    userId,
    listId,
    showCompleted: false,
    createdAt: ts,
    updatedAt: ts,
  });
  return { tenantId, userId, listId, showCompleted: false, defaultViewId: null, createdAt: ts, updatedAt: ts };
}

export async function updatePrefs(listId: string, patch: { showCompleted?: boolean }) {
  const { db, userId, tenantId } = await getContext();
  await db
    .update(tasksUserListPrefs)
    .set({ ...patch, updatedAt: now() })
    .where(
      and(
        eq(tasksUserListPrefs.tenantId, tenantId),
        eq(tasksUserListPrefs.userId, userId),
        eq(tasksUserListPrefs.listId, listId),
      ),
    );
}

// ── Notification preferences (due/overdue notifications, v0.11) ────────────

const MORNING_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The caller's notification prefs, or the defaults when never saved. */
export async function getNotificationPrefs() {
  const { db, userId, tenantId } = await getContext();
  const rows = await db
    .select()
    .from(tasksNotificationPrefs)
    .where(
      and(
        eq(tasksNotificationPrefs.tenantId, tenantId),
        eq(tasksNotificationPrefs.userId, userId),
      ),
    );
  const row = rows[0];
  return {
    enabled: row?.enabled ?? false,
    morningTime: row?.morningTime ?? '08:00',
  };
}

/**
 * Upserts the caller's notification prefs. `timezone` is the browser's IANA
 * zone (Intl.DateTimeFormat().resolvedOptions().timeZone), re-captured on
 * every save so a user who moves keeps a current "morning" — it defines the
 * local frame the scheduler evaluates morning_time and due times in
 * (app/_jobs/due-reminders.ts).
 */
export async function saveNotificationPrefs(input: {
  enabled: boolean;
  morningTime: string;
  timezone: string;
}) {
  const { db, userId, tenantId } = await getContext();
  if (!MORNING_TIME_RE.test(input.morningTime)) {
    throw new Error('morningTime must be HH:MM (24h)');
  }
  const timezone = isValidTimeZone(input.timezone) ? input.timezone : 'UTC';
  const ts = now();

  const updated = await db
    .update(tasksNotificationPrefs)
    .set({ enabled: input.enabled, morningTime: input.morningTime, timezone, updatedAt: ts })
    .where(
      and(
        eq(tasksNotificationPrefs.tenantId, tenantId),
        eq(tasksNotificationPrefs.userId, userId),
      ),
    )
    .returning({ userId: tasksNotificationPrefs.userId });
  if (updated.length > 0) return;

  await db.insert(tasksNotificationPrefs).values({
    tenantId,
    userId,
    enabled: input.enabled,
    morningTime: input.morningTime,
    timezone,
    createdAt: ts,
    updatedAt: ts,
  });
}
