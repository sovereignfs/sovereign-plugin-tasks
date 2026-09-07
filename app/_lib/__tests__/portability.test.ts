import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  DeletionContext,
  DeletionResult,
  ExportContext,
  ImportContext,
  PluginExportSection,
} from '@sovereignfs/sdk';

type Row = Record<string, unknown>;
type Condition = { kind: 'eq'; key: string; value: unknown } | { kind: 'and'; conditions: Condition[] };

function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

// Real and()/eq() build opaque SQL AST nodes; mocking them to build a small,
// interpretable Condition tree instead lets the fake db below actually
// filter rows per-query, matching the precision the real handler depends on.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value,
    }),
    and: (...conditions: Condition[]): Condition => ({ kind: 'and', conditions }),
    // Reuses the 'eq' node shape with an array `value` — matches() below
    // special-cases an array value as membership rather than equality.
    inArray: (column: { name: string }, values: unknown[]): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value: values,
    }),
  };
});

function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.kind === 'eq') {
    if (Array.isArray(condition.value)) return condition.value.includes(row[condition.key]);
    return row[condition.key] === condition.value;
  }
  return condition.conditions.every((c) => matches(row, c));
}

const capturedExporter = { fn: null as ((ctx: ExportContext) => Promise<PluginExportSection>) | null };
const capturedImporter = {
  fn: null as ((section: PluginExportSection, ctx: ImportContext) => Promise<void>) | null,
};
const capturedDeleter = {
  fn: null as ((ctx: DeletionContext) => Promise<DeletionResult>) | null,
};

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    db: { getClient: vi.fn(async () => fakeDb) },
    portability: {
      provideExport: vi.fn(async (fn: typeof capturedExporter.fn) => {
        capturedExporter.fn = fn;
      }),
      provideImport: vi.fn(async (fn: typeof capturedImporter.fn) => {
        capturedImporter.fn = fn;
      }),
      provideDelete: vi.fn(async (fn: typeof capturedDeleter.fn) => {
        capturedDeleter.fn = fn;
      }),
    },
  },
}));

interface Store extends Record<string, Row[]> {
  tasks_lists: Row[];
  tasks_user_list_prefs: Row[];
  tasks_views: Row[];
  tasks_items: Row[];
  tasks_notification_prefs: Row[];
}

let store: Store = {
  tasks_lists: [],
  tasks_user_list_prefs: [],
  tasks_views: [],
  tasks_items: [],
  tasks_notification_prefs: [],
};

function resetStore() {
  store = {
    tasks_lists: [],
    tasks_user_list_prefs: [],
    tasks_views: [],
    tasks_items: [],
    tasks_notification_prefs: [],
  };
}

const fakeDb = {
  select(columns?: Record<string, unknown>) {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        return {
          where: async (condition?: Condition) => {
            const rows = (store[tableName] ?? []).filter((row) => matches(row, condition));
            if (!columns) return rows;
            return rows.map((row) => {
              const projected: Row = {};
              for (const key of Object.keys(columns)) projected[key] = row[key];
              return projected;
            });
          },
        };
      },
    };
  },
  insert(table: Table) {
    const tableName = getTableName(table);
    return {
      values: async (row: Row) => {
        (store[tableName] ??= []).push(row);
      },
    };
  },
  delete(table: Table) {
    const tableName = getTableName(table);
    return {
      where: async (condition?: Condition) => {
        store[tableName] = (store[tableName] ?? []).filter((row) => !matches(row, condition));
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set(values: Row) {
        return {
          where: async (condition?: Condition) => {
            for (const row of store[tableName] ?? []) {
              if (matches(row, condition)) Object.assign(row, values);
            }
          },
        };
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('portability export', () => {
  it("exports the user's owned lists, items, views, prefs, and notification prefs", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.tasks_lists = [
      {
        id: 'list-1',
        tenantId: 't1',
        ownerId: 'user-1',
        title: 'Work',
        color: 'blue',
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
      // A different owner's list must never appear in user-1's export.
      {
        id: 'list-2',
        tenantId: 't1',
        ownerId: 'user-9',
        title: 'Not mine',
        color: null,
        sortOrder: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    store.tasks_user_list_prefs = [
      {
        tenantId: 't1',
        userId: 'user-1',
        listId: 'list-1',
        showCompleted: true,
        defaultViewId: 'view-1',
        createdAt: 2,
        updatedAt: 2,
      },
    ];
    store.tasks_views = [
      {
        id: 'view-1',
        tenantId: 't1',
        listId: 'list-1',
        ownerId: 'user-1',
        name: 'List',
        kind: 'list',
        config: '{}',
        isDefault: true,
        sortOrder: 0,
        createdAt: 3,
        updatedAt: 3,
      },
    ];
    store.tasks_items = [
      {
        id: 'item-1',
        tenantId: 't1',
        listId: 'list-1',
        parentId: null,
        assigneeId: null,
        title: 'Parent task',
        notes: null,
        favorite: true,
        dueDate: '2026-01-01',
        dueTime: null,
        reminderSentAt: null,
        completedAt: null,
        sortOrder: 0,
        recurrenceRule: null,
        seriesId: null,
        createdAt: 4,
        updatedAt: 4,
      },
      {
        id: 'item-2',
        tenantId: 't1',
        listId: 'list-1',
        parentId: 'item-1',
        assigneeId: null,
        title: 'Subtask',
        notes: null,
        favorite: false,
        dueDate: null,
        dueTime: null,
        reminderSentAt: null,
        completedAt: null,
        sortOrder: 0,
        recurrenceRule: null,
        seriesId: null,
        createdAt: 5,
        updatedAt: 5,
      },
    ];
    store.tasks_notification_prefs = [
      {
        tenantId: 't1',
        userId: 'user-1',
        enabled: true,
        morningTime: '08:00',
        timezone: 'UTC',
        lastDigestDate: '2026-01-01',
        createdAt: 6,
        updatedAt: 6,
      },
    ];

    const section = await capturedExporter.fn?.({
      userId: 'user-1',
      tenantId: 't1',
      options: { includeFiles: true },
    });

    expect(section?.pluginId).toBe('fs.sovereign.tasks');
    expect(section?.schemaVersion).toBe(1);
    const data = section?.data as {
      lists: Array<{ id: string }>;
      userListPrefs: unknown[];
      views: unknown[];
      items: unknown[];
      notificationPrefs: { enabled: boolean } | null;
    };
    expect(data.lists).toHaveLength(1);
    expect(data.lists[0]?.id).toBe('list-1');
    expect(data.userListPrefs).toHaveLength(1);
    expect(data.views).toHaveLength(1);
    expect(data.items).toHaveLength(2);
    expect(data.notificationPrefs).toMatchObject({ enabled: true, timezone: 'UTC' });
  });

  it('exports null notificationPrefs when the user never opened notification settings', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section = await capturedExporter.fn?.({
      userId: 'user-1',
      tenantId: 't1',
      options: { includeFiles: true },
    });
    const data = section?.data as { notificationPrefs: unknown };
    expect(data.notificationPrefs).toBeNull();
  });
});

describe('portability import', () => {
  it('rejects a section with an unrecognized shape', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await expect(
      capturedImporter.fn?.(
        { pluginId: 'fs.sovereign.tasks', schemaVersion: 1, data: { nonsense: true } },
        { userId: 'user-2', tenantId: 't1', remapId: (id) => `new-${id}` },
      ),
    ).rejects.toThrow('unrecognized shape');
  });

  it('rejects an unrecognized schemaVersion even with a well-shaped payload', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    await expect(
      capturedImporter.fn?.(
        {
          pluginId: 'fs.sovereign.tasks',
          schemaVersion: 99,
          data: { lists: [], userListPrefs: [], views: [], items: [], notificationPrefs: null },
        },
        { userId: 'user-2', tenantId: 't1', remapId: (id) => `new-${id}` },
      ),
    ).rejects.toThrow('unrecognized shape');
  });

  it('restores lists/views/items with remapped ids, preserving parent and series links', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.tasks',
      schemaVersion: 1,
      data: {
        lists: [
          { id: 'list-1', title: 'Work', color: 'blue', sortOrder: 0, createdAt: 1, updatedAt: 1 },
        ],
        userListPrefs: [
          {
            listId: 'list-1',
            showCompleted: true,
            defaultViewId: 'view-1',
            createdAt: 2,
            updatedAt: 2,
          },
        ],
        views: [
          {
            id: 'view-1',
            listId: 'list-1',
            name: 'List',
            kind: 'list',
            config: '{}',
            isDefault: true,
            sortOrder: 0,
            createdAt: 3,
            updatedAt: 3,
          },
        ],
        items: [
          {
            id: 'item-1',
            listId: 'list-1',
            parentId: null,
            assigneeId: null,
            title: 'Recurring task',
            notes: null,
            favorite: true,
            dueDate: '2026-01-01',
            dueTime: null,
            reminderSentAt: null,
            completedAt: null,
            sortOrder: 0,
            recurrenceRule: 'FREQ=DAILY',
            seriesId: 'series-1',
            createdAt: 4,
            updatedAt: 4,
          },
          {
            id: 'item-2',
            listId: 'list-1',
            parentId: 'item-1',
            assigneeId: null,
            title: 'Subtask',
            notes: null,
            favorite: false,
            dueDate: null,
            dueTime: null,
            reminderSentAt: null,
            completedAt: null,
            sortOrder: 0,
            recurrenceRule: null,
            seriesId: null,
            createdAt: 5,
            updatedAt: 5,
          },
          {
            // Same series as item-1 — remapId's per-import stability must
            // land both on the same new seriesId.
            id: 'item-3',
            listId: 'list-1',
            parentId: null,
            assigneeId: null,
            title: 'Recurring task (next occurrence)',
            notes: null,
            favorite: false,
            dueDate: '2026-01-02',
            dueTime: null,
            reminderSentAt: null,
            completedAt: null,
            sortOrder: 1,
            recurrenceRule: 'FREQ=DAILY',
            seriesId: 'series-1',
            createdAt: 4,
            updatedAt: 4,
          },
          {
            // References a list not present in `lists` — must be skipped.
            id: 'item-4',
            listId: 'ghost-list',
            parentId: null,
            assigneeId: null,
            title: 'Orphan',
            notes: null,
            favorite: false,
            dueDate: null,
            dueTime: null,
            reminderSentAt: null,
            completedAt: null,
            sortOrder: 0,
            recurrenceRule: null,
            seriesId: null,
            createdAt: 4,
            updatedAt: 4,
          },
        ],
        notificationPrefs: {
          enabled: true,
          morningTime: '08:00',
          timezone: 'UTC',
          lastDigestDate: null,
          createdAt: 6,
          updatedAt: 6,
        },
      },
    };

    await capturedImporter.fn?.(section, {
      userId: 'user-2',
      tenantId: 't1',
      remapId: (originalId) => `new-${originalId}`,
    });

    expect(store.tasks_lists).toHaveLength(1);
    expect(store.tasks_lists.at(0)).toMatchObject({ id: 'new-list-1', ownerId: 'user-2', title: 'Work' });

    expect(store.tasks_user_list_prefs).toHaveLength(1);
    expect(store.tasks_user_list_prefs.at(0)).toMatchObject({
      listId: 'new-list-1',
      userId: 'user-2',
      defaultViewId: 'new-view-1',
    });

    expect(store.tasks_views).toHaveLength(1);
    expect(store.tasks_views.at(0)).toMatchObject({ id: 'new-view-1', listId: 'new-list-1' });

    // Only 3 of 4 items restored — item-4 (ghost list) skipped.
    expect(store.tasks_items).toHaveLength(3);
    const byOriginal = (title: string) => store.tasks_items.find((i) => i.title === title);
    const parent = byOriginal('Recurring task');
    const subtask = byOriginal('Subtask');
    const nextOccurrence = byOriginal('Recurring task (next occurrence)');
    expect(parent).toMatchObject({ id: 'new-item-1', listId: 'new-list-1', seriesId: 'new-series-1' });
    expect(subtask).toMatchObject({ id: 'new-item-2', parentId: 'new-item-1' });
    // Same seriesId remapped consistently across both occurrences.
    expect(nextOccurrence).toMatchObject({ id: 'new-item-3', seriesId: 'new-series-1' });

    expect(store.tasks_notification_prefs).toHaveLength(1);
    expect(store.tasks_notification_prefs.at(0)).toMatchObject({ userId: 'user-2', enabled: true });
  });

  it('never overwrites an existing notification-prefs row on a second import (per-user singleton)', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.tasks_notification_prefs = [
      {
        tenantId: 't1',
        userId: 'user-2',
        enabled: false,
        morningTime: '09:00',
        timezone: 'Europe/Berlin',
        lastDigestDate: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ];

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.tasks',
      schemaVersion: 1,
      data: {
        lists: [],
        userListPrefs: [],
        views: [],
        items: [],
        notificationPrefs: {
          enabled: true,
          morningTime: '08:00',
          timezone: 'UTC',
          lastDigestDate: null,
          createdAt: 6,
          updatedAt: 6,
        },
      },
    };

    await capturedImporter.fn?.(section, {
      userId: 'user-2',
      tenantId: 't1',
      remapId: (originalId) => `new-${originalId}`,
    });

    // Still exactly the pre-existing row — not overwritten, not duplicated.
    expect(store.tasks_notification_prefs).toHaveLength(1);
    expect(store.tasks_notification_prefs.at(0)).toMatchObject({ enabled: false, timezone: 'Europe/Berlin' });
  });

  it('is additive across repeated imports — a second import of the same bundle creates a second copy with fresh ids', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const section: PluginExportSection = {
      pluginId: 'fs.sovereign.tasks',
      schemaVersion: 1,
      data: {
        lists: [{ id: 'list-1', title: 'Work', color: null, sortOrder: 0, createdAt: 1, updatedAt: 1 }],
        userListPrefs: [],
        views: [],
        items: [],
        notificationPrefs: null,
      },
    };

    let counter = 0;
    const remapId = (originalId: string) => `import${counter}-${originalId}`;

    counter = 1;
    await capturedImporter.fn?.(section, { userId: 'user-2', tenantId: 't1', remapId });
    counter = 2;
    await capturedImporter.fn?.(section, { userId: 'user-2', tenantId: 't1', remapId });

    expect(store.tasks_lists).toHaveLength(2);
    expect(store.tasks_lists.map((l) => l.id).sort()).toEqual(['import1-list-1', 'import2-list-1']);
  });
});

describe('portability delete', () => {
  it("deletes every list the user owns and everything in it, plus the user's notification prefs", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.tasks_lists = [
      { id: 'list-1', tenantId: 't1', ownerId: 'user-1' },
      // A different user's list must survive.
      { id: 'list-9', tenantId: 't1', ownerId: 'user-9' },
    ];
    store.tasks_items = [
      { id: 'item-1', tenantId: 't1', listId: 'list-1' },
      { id: 'item-2', tenantId: 't1', listId: 'list-1' },
      { id: 'item-9', tenantId: 't1', listId: 'list-9' },
    ];
    store.tasks_user_list_prefs = [{ tenantId: 't1', userId: 'user-1', listId: 'list-1' }];
    store.tasks_views = [{ id: 'view-1', tenantId: 't1', listId: 'list-1' }];
    store.tasks_notification_prefs = [{ tenantId: 't1', userId: 'user-1', enabled: true }];

    const result = await capturedDeleter.fn?.({ userId: 'user-1', tenantId: 't1', db: fakeDb });

    expect(store.tasks_lists).toEqual([{ id: 'list-9', tenantId: 't1', ownerId: 'user-9' }]);
    expect(store.tasks_items).toEqual([{ id: 'item-9', tenantId: 't1', listId: 'list-9' }]);
    expect(store.tasks_user_list_prefs).toHaveLength(0);
    expect(store.tasks_views).toHaveLength(0);
    expect(store.tasks_notification_prefs).toHaveLength(0);
    // 1 list + 2 items + 1 prefs row + 1 view + 1 notification-prefs row.
    expect(result?.deleted).toBe(6);
  });

  it('reports zero deleted for a user with no tasks data at all', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    const result = await capturedDeleter.fn?.({ userId: 'user-1', tenantId: 't1', db: fakeDb });
    expect(result?.deleted).toBe(0);
  });

  it("severs the user's assignment on another user's list instead of deleting the task (RFC 0097)", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    // list-9 belongs to user-9; user-1 was assigned two tasks on it.
    store.tasks_lists = [{ id: 'list-9', tenantId: 't1', ownerId: 'user-9' }];
    store.tasks_items = [
      { id: 'item-assigned', tenantId: 't1', listId: 'list-9', assigneeId: 'user-1' },
      // Untouched: someone else's assignment on the same list.
      { id: 'item-other', tenantId: 't1', listId: 'list-9', assigneeId: 'user-9' },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'user-1', tenantId: 't1', db: fakeDb });

    // The task still exists — it belongs to user-9's list.
    expect(store.tasks_items).toHaveLength(2);
    expect(store.tasks_items.find((r) => r.id === 'item-assigned')?.assigneeId).toBeNull();
    expect(store.tasks_items.find((r) => r.id === 'item-other')?.assigneeId).toBe('user-9');

    // Severed, not deleted.
    expect(result?.anonymized).toBe(1);
    expect(result?.deleted).toBe(0);
  });

  it('does not sever an assignment belonging to another tenant', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.tasks_items = [{ id: 'item-t2', tenantId: 't2', listId: 'list-9', assigneeId: 'user-1' }];

    const result = await capturedDeleter.fn?.({ userId: 'user-1', tenantId: 't1', db: fakeDb });

    expect(store.tasks_items[0]?.assigneeId).toBe('user-1');
    expect(result?.anonymized).toBe(0);
  });
});
