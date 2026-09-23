import { sdk } from '@sovereignfs/sdk';
import type {
  DeletionContext,
  DeletionResult,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';
import { and, eq, inArray } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import {
  tasksItems,
  tasksLists,
  tasksNotificationPrefs,
  tasksUserListPrefs,
  tasksViews,
} from '../_db/schema';

// The SDK intentionally returns an opaque dialect-agnostic DB client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;

// Exported alongside exportTasksData/importTasksData/isTasksExportData below
// (TSK-31) — the single-file export/import in app/_lib/dataFile.ts calls
// these directly with a locally-built context instead of the platform's
// portability registry, and needs the same plugin id/schema version to
// validate a file before handing it to importTasksData.
export const PLUGIN_ID = 'fs.sovereign.tasks';
export const EXPORT_SCHEMA_VERSION = 1;

function now() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Registers Tasks' export/import/delete participation (RFC 0007 / RFC 0033,
 * TSK-29). Must be called from a request-scoped Tasks route — this repo
 * calls it from `app/layout.tsx`, same as every other request-scoped setup
 * (registrations are in-process and reset on restart).
 */
export async function registerPortabilityHandlers(): Promise<void> {
  await sdk.portability.provideExport(exportTasksData);
  await sdk.portability.provideImport(importTasksData);
  await sdk.portability.provideDelete(deleteAllTasksData);
}

// ---- Export shape ----
// Keyed by each row's *original* id — the import handler remaps every
// plugin-owned id via ctx.remapId, so cross-references below travel as the
// original id and get translated at import time.

interface ExportList {
  id: string;
  title: string;
  color: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

interface ExportUserListPrefs {
  listId: string;
  showCompleted: boolean;
  defaultViewId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ExportView {
  id: string;
  listId: string;
  name: string;
  kind: string;
  config: string;
  isDefault: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

interface ExportItem {
  id: string;
  listId: string;
  parentId: string | null;
  assigneeId: string | null;
  title: string;
  notes: string | null;
  favorite: boolean;
  dueDate: string | null;
  dueTime: string | null;
  reminderSentAt: number | null;
  completedAt: number | null;
  sortOrder: number;
  recurrenceRule: string | null;
  seriesId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ExportNotificationPrefs {
  enabled: boolean;
  morningTime: string;
  timezone: string;
  lastDigestDate: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface TasksExportData {
  lists: ExportList[];
  userListPrefs: ExportUserListPrefs[];
  views: ExportView[];
  items: ExportItem[];
  /** null when the user never opened notification settings (no row exists). */
  notificationPrefs: ExportNotificationPrefs | null;
}

export async function exportTasksData(ctx: ExportContext): Promise<PluginExportSection> {
  const db = (await sdk.db.getClient()) as Db;
  const { userId, tenantId } = ctx;

  const listRows = await db
    .select()
    .from(tasksLists)
    .where(and(eq(tasksLists.tenantId, tenantId), eq(tasksLists.ownerId, userId)));
  const listIds = listRows.map((l) => l.id);

  const lists: ExportList[] = listRows.map((l) => ({
    id: l.id,
    title: l.title,
    color: l.color,
    sortOrder: l.sortOrder,
    createdAt: l.createdAt,
    updatedAt: l.updatedAt,
  }));

  let userListPrefs: ExportUserListPrefs[] = [];
  let views: ExportView[] = [];
  let items: ExportItem[] = [];

  if (listIds.length > 0) {
    const [prefRows, viewRows, itemRows] = await Promise.all([
      db
        .select()
        .from(tasksUserListPrefs)
        .where(
          and(
            eq(tasksUserListPrefs.tenantId, tenantId),
            eq(tasksUserListPrefs.userId, userId),
            inArray(tasksUserListPrefs.listId, listIds),
          ),
        ),
      db
        .select()
        .from(tasksViews)
        .where(and(eq(tasksViews.tenantId, tenantId), inArray(tasksViews.listId, listIds))),
      db
        .select()
        .from(tasksItems)
        .where(and(eq(tasksItems.tenantId, tenantId), inArray(tasksItems.listId, listIds))),
    ]);

    userListPrefs = prefRows.map((p) => ({
      listId: p.listId,
      showCompleted: p.showCompleted,
      defaultViewId: p.defaultViewId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
    views = viewRows.map((v) => ({
      id: v.id,
      listId: v.listId,
      name: v.name,
      kind: v.kind,
      config: v.config,
      isDefault: v.isDefault,
      sortOrder: v.sortOrder,
      createdAt: v.createdAt,
      updatedAt: v.updatedAt,
    }));
    items = itemRows.map((i) => ({
      id: i.id,
      listId: i.listId,
      parentId: i.parentId,
      assigneeId: i.assigneeId,
      title: i.title,
      notes: i.notes,
      favorite: i.favorite,
      dueDate: i.dueDate,
      dueTime: i.dueTime,
      reminderSentAt: i.reminderSentAt,
      completedAt: i.completedAt,
      sortOrder: i.sortOrder,
      recurrenceRule: i.recurrenceRule,
      seriesId: i.seriesId,
      createdAt: i.createdAt,
      updatedAt: i.updatedAt,
    }));
  }

  const notifRows = await db
    .select()
    .from(tasksNotificationPrefs)
    .where(
      and(eq(tasksNotificationPrefs.tenantId, tenantId), eq(tasksNotificationPrefs.userId, userId)),
    );
  const notifRow = notifRows[0];
  const notificationPrefs: ExportNotificationPrefs | null = notifRow
    ? {
        enabled: notifRow.enabled,
        morningTime: notifRow.morningTime,
        timezone: notifRow.timezone,
        lastDigestDate: notifRow.lastDigestDate,
        createdAt: notifRow.createdAt,
        updatedAt: notifRow.updatedAt,
      }
    : null;

  const data: TasksExportData = { lists, userListPrefs, views, items, notificationPrefs };
  return { pluginId: PLUGIN_ID, schemaVersion: EXPORT_SCHEMA_VERSION, data };
}

// ---- Import ----

export function isTasksExportData(value: unknown): value is TasksExportData {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<TasksExportData>;
  return (
    Array.isArray(candidate.lists) &&
    Array.isArray(candidate.userListPrefs) &&
    Array.isArray(candidate.views) &&
    Array.isArray(candidate.items)
  );
}

export async function importTasksData(
  section: PluginExportSection,
  ctx: ImportContext,
): Promise<void> {
  if (section.schemaVersion !== EXPORT_SCHEMA_VERSION || !isTasksExportData(section.data)) {
    throw new Error('Tasks import section has an unrecognized shape.');
  }
  const data = section.data;
  const db = (await sdk.db.getClient()) as Db;
  const ts = now();

  // Membership checked against *original* ids (not ctx.remapId's minted new
  // ones) — remapId will happily mint an id for any string handed to it, so
  // checking existence here (not just calling it) is what keeps an item
  // whose listId/parentId isn't actually part of this export from landing as
  // a dangling reference instead of being skipped.
  const originalListIds = new Set(data.lists.map((l) => l.id));
  const originalViewIds = new Set(data.views.map((v) => v.id));
  const originalItemIds = new Set(data.items.map((i) => i.id));

  for (const list of data.lists) {
    await db.insert(tasksLists).values({
      id: ctx.remapId(list.id),
      tenantId: ctx.tenantId,
      ownerId: ctx.userId,
      title: list.title,
      color: list.color,
      sortOrder: list.sortOrder,
      createdAt: list.createdAt,
      updatedAt: ts,
    });
  }

  for (const prefs of data.userListPrefs) {
    if (!originalListIds.has(prefs.listId)) continue;
    const newDefaultViewId =
      prefs.defaultViewId && originalViewIds.has(prefs.defaultViewId)
        ? ctx.remapId(prefs.defaultViewId)
        : null;
    await db.insert(tasksUserListPrefs).values({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      listId: ctx.remapId(prefs.listId),
      showCompleted: prefs.showCompleted,
      defaultViewId: newDefaultViewId,
      createdAt: prefs.createdAt,
      updatedAt: ts,
    });
  }

  for (const view of data.views) {
    if (!originalListIds.has(view.listId)) continue;
    await db.insert(tasksViews).values({
      id: ctx.remapId(view.id),
      tenantId: ctx.tenantId,
      listId: ctx.remapId(view.listId),
      ownerId: ctx.userId,
      name: view.name,
      kind: view.kind,
      config: view.config,
      isDefault: view.isDefault,
      sortOrder: view.sortOrder,
      createdAt: view.createdAt,
      updatedAt: ts,
    });
  }

  for (const item of data.items) {
    if (!originalListIds.has(item.listId)) continue;
    // A subtask whose parent isn't in this export (shouldn't happen — both
    // travel in the same flat `items` array — but validated the same way as
    // every other cross-reference here rather than assumed).
    if (item.parentId && !originalItemIds.has(item.parentId)) continue;
    await db.insert(tasksItems).values({
      id: ctx.remapId(item.id),
      tenantId: ctx.tenantId,
      listId: ctx.remapId(item.listId),
      parentId: item.parentId ? ctx.remapId(item.parentId) : null,
      // Nullable, unused today — collaboration (TSK-10-14) is still blocked
      // on sdk.directory, so this is always null in practice.
      assigneeId: item.assigneeId,
      title: item.title,
      notes: item.notes,
      favorite: item.favorite,
      dueDate: item.dueDate,
      dueTime: item.dueTime,
      reminderSentAt: item.reminderSentAt,
      completedAt: item.completedAt,
      sortOrder: item.sortOrder,
      recurrenceRule: item.recurrenceRule,
      // Not a literal FK — a recurring series is just every item sharing the
      // same seriesId. remapId's per-import stability (same original id ⇒
      // same new id, every call) is what keeps an imported series linked to
      // itself without a separate id map here.
      seriesId: item.seriesId ? ctx.remapId(item.seriesId) : null,
      createdAt: item.createdAt,
      updatedAt: ts,
    });
  }

  // tasksNotificationPrefs is a per-user singleton (PK is tenantId+userId,
  // not an id this plugin mints) — unlike every other table above, a second
  // import into the same account would collide on that PK instead of
  // creating a harmless duplicate. "Additive, never wipes" here means never
  // overwriting whatever the user already has, not silently erroring: only
  // seed it when the account doesn't have one yet.
  if (data.notificationPrefs) {
    const existing = await db
      .select({ userId: tasksNotificationPrefs.userId })
      .from(tasksNotificationPrefs)
      .where(
        and(
          eq(tasksNotificationPrefs.tenantId, ctx.tenantId),
          eq(tasksNotificationPrefs.userId, ctx.userId),
        ),
      );
    if (existing.length === 0) {
      await db.insert(tasksNotificationPrefs).values({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        enabled: data.notificationPrefs.enabled,
        morningTime: data.notificationPrefs.morningTime,
        timezone: data.notificationPrefs.timezone,
        lastDigestDate: data.notificationPrefs.lastDigestDate,
        createdAt: data.notificationPrefs.createdAt,
        updatedAt: ts,
      });
    }
  }
}

// ---- Delete ----

/**
 * Removes this user's Tasks data on account deletion (RFC 0033), and severs
 * their attribution on other people's tasks (RFC 0097).
 *
 * `assignee_id` is nullable and, as of this version, unreachable in practice
 * — v0.2 collaboration (`tasks_list_members`) hasn't shipped, so no action
 * yet sets it to a user other than the list owner. SPEC.md already commits to
 * severing on the *member-removal* trigger ("Removing a member auto-unassigns
 * their tasks (`assignee_id` -> `null`)") once that ships; this does the same
 * thing on the *account-deletion* trigger, so the convention is already in
 * place — see RFC 0097 for why `null` and not a sentinel, and why severed
 * rows count separately from `deleted`.
 */
async function deleteAllTasksData(ctx: DeletionContext): Promise<DeletionResult> {
  const db = ctx.db as Db;
  let deleted = 0;

  // Mirrors deleteList()'s own app-layer cascade (actions.ts) — SQLite has
  // no enforced FK here — run per owned list, then the user's own
  // notification prefs (not list-scoped). Can't reuse deleteList() itself:
  // it authorizes via a live session (getContext()), which an account
  // deletion flow doesn't have — ctx.userId/ctx.tenantId are supplied
  // directly instead.
  const listRows = await db
    .select({ id: tasksLists.id })
    .from(tasksLists)
    .where(and(eq(tasksLists.tenantId, ctx.tenantId), eq(tasksLists.ownerId, ctx.userId)));

  for (const list of listRows) {
    // Count via a select before deleting (not delete().returning()) — same
    // idiom actions.ts's own deleteList() implicitly follows by never
    // needing a count at all; used here because DeletionResult must report one.
    const [itemRows, prefRows, viewRows] = await Promise.all([
      db
        .select({ id: tasksItems.id })
        .from(tasksItems)
        .where(and(eq(tasksItems.listId, list.id), eq(tasksItems.tenantId, ctx.tenantId))),
      db
        .select({ listId: tasksUserListPrefs.listId })
        .from(tasksUserListPrefs)
        .where(
          and(eq(tasksUserListPrefs.listId, list.id), eq(tasksUserListPrefs.tenantId, ctx.tenantId)),
        ),
      db
        .select({ id: tasksViews.id })
        .from(tasksViews)
        .where(and(eq(tasksViews.listId, list.id), eq(tasksViews.tenantId, ctx.tenantId))),
    ]);
    await db
      .delete(tasksItems)
      .where(and(eq(tasksItems.listId, list.id), eq(tasksItems.tenantId, ctx.tenantId)));
    await db
      .delete(tasksUserListPrefs)
      .where(and(eq(tasksUserListPrefs.listId, list.id), eq(tasksUserListPrefs.tenantId, ctx.tenantId)));
    await db
      .delete(tasksViews)
      .where(and(eq(tasksViews.listId, list.id), eq(tasksViews.tenantId, ctx.tenantId)));
    deleted += itemRows.length + prefRows.length + viewRows.length;
  }

  deleted += listRows.length;
  await db
    .delete(tasksLists)
    .where(and(eq(tasksLists.tenantId, ctx.tenantId), eq(tasksLists.ownerId, ctx.userId)));

  const notifRows = await db
    .select({ userId: tasksNotificationPrefs.userId })
    .from(tasksNotificationPrefs)
    .where(
      and(
        eq(tasksNotificationPrefs.tenantId, ctx.tenantId),
        eq(tasksNotificationPrefs.userId, ctx.userId),
      ),
    );
  await db
    .delete(tasksNotificationPrefs)
    .where(
      and(
        eq(tasksNotificationPrefs.tenantId, ctx.tenantId),
        eq(tasksNotificationPrefs.userId, ctx.userId),
      ),
    );
  deleted += notifRows.length;

  // Everything above deletes tasksItems belonging to lists this user owned.
  // What still matches assignee_id at this point is a task on someone else's
  // list — RFC 0097's middle bucket: sever the attribution, keep the row.
  const orphanedAssignments = await db
    .select({ id: tasksItems.id })
    .from(tasksItems)
    .where(and(eq(tasksItems.tenantId, ctx.tenantId), eq(tasksItems.assigneeId, ctx.userId)));
  if (orphanedAssignments.length > 0) {
    await db
      .update(tasksItems)
      .set({ assigneeId: null })
      .where(and(eq(tasksItems.tenantId, ctx.tenantId), eq(tasksItems.assigneeId, ctx.userId)));
  }

  // Severed rows are reported separately, never folded into deleted — they
  // still exist, and deleted is the count an operator would cite to evidence
  // an erasure request.
  return { deleted, anonymized: orphanedAssignments.length };
}
