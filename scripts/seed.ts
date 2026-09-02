/**
 * Dev seed script — populates this plugin's isolated dev database with
 * realistic sample lists and tasks covering (as close to) every UI scenario
 * as one seed run reasonably can: an overdue task and a due-today task
 * (each in a different list), several upcoming due dates, free-text notes,
 * starred tasks spanning two different lists (so the virtual Starred view
 * has real cross-list content), a recurring task, subtask parents at every
 * completion state (0%, partial, 100%), two long titles (wrap/truncation
 * test), two already-completed top-level tasks, and one near-empty list.
 * v0.1 is private/owner-scoped only (v0.2 collaboration is blocked on
 * sdk.directory — see CLAUDE.md) — everything here belongs to one user,
 * unlike sovereign-plugin-kanban's multi-account seed.
 *
 * Requires `pnpm sv seed` to have already been run once from the monorepo
 * root — this script looks up its target user by email, never a hardcoded
 * id (those are randomly generated per-database):
 *   owner@sovereign.local   (sign in as this one, password: sovereign)
 *
 * Run from this plugin's own directory (or `pnpm --filter
 * @sovereignfs/sovereign-tasks exec tsx scripts/seed.ts` from the monorepo
 * root), with the dev sqld instance already running (`pnpm dev` or `tsx
 * scripts/ensure-sqld.ts` starts it):
 *
 *   pnpm exec tsx scripts/seed.ts
 *   pnpm exec tsx scripts/seed.ts --reset   # wipe this script's own data first, then reseed
 *
 * Idempotent by default: no-ops (prints what already exists) if the seed
 * data is already present, rather than duplicating it on a second run.
 * `--reset` only ever deletes rows under this script's own fixed
 * `seed-tasks-*` ids — never `tasks_notification_prefs` (a per-user
 * singleton this script only ever inserts with `onConflictDoNothing`, so a
 * real preference change made through the UI after seeding is never
 * clobbered by a later reset).
 *
 * Connects directly to the dev sqld instance via `@libsql/client` rather
 * than importing `@sovereignfs/db` — this plugin's own `package.json`
 * doesn't depend on internal platform packages, and both the monorepo's own
 * root `scripts/seed.ts` and sovereign-plugin-kanban's `scripts/seed.ts` set
 * this precedent for standalone dev tooling. SQLite (sqld) dev only; this
 * plugin has no Postgres dev seed path today.
 */
import { createClient, type Client } from '@libsql/client';
import { eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { addDaysISO, todayISO } from '../app/_lib/date';
import { tasksItems, tasksLists, tasksNotificationPrefs, tasksViews } from '../app/_db/schema';

// Deliberately not importing recurrence.ts's patternToRule() here — that
// file's `import { RRule } from 'rrule'` resolves fine inside the Next.js/
// webpack-bundled app (the only place it normally runs) but fails under
// plain `tsx` with "does not provide an export named 'RRule'", an ESM/CJS
// interop mismatch specific to running this package outside a bundler.
// Verified independently via a throwaway `node -e` using `require('rrule')`
// (CJS, sidesteps the failing ESM path) that RRule({freq:WEEKLY,interval:1,
// byweekday:[MO,WE,FR],dtstart:null}).toString() — the exact call
// patternToRule() itself makes — produces this literal string, and that
// RRule.parseString() (what ruleToPattern() uses to read it back for the
// RecurrenceEditor UI) parses it correctly.
const WEEKLY_MWF_RRULE = 'RRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR';

// pluginNamespaceName('fs.sovereign.tasks') from @sovereignfs/db's sqld.ts —
// duplicated as a literal rather than imported, same reason this whole file
// avoids @sovereignfs/db (see the module doc comment above).
const TASKS_NAMESPACE = 'plugin_fs_sovereign_tasks';
const AUTH_NAMESPACE = 'sovereign_auth';
const TENANT_ID = 'default';
const RESET = process.argv.includes('--reset');

function namespacedClient(namespace: string): Client {
  return createClient({
    url: process.env.SQLD_URL ?? 'http://localhost:28080',
    fetch: (input: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      headers.set('x-namespace', namespace);
      return fetch(input as string, { ...init, headers });
    },
  });
}

async function lookupDevUser(): Promise<{ id: string; name: string; email: string }> {
  const auth = namespacedClient(AUTH_NAMESPACE);
  const email = 'owner@sovereign.local';
  const res = await auth.execute({
    sql: `SELECT id, name, email FROM "user" WHERE email = ?`,
    args: [email],
  });
  auth.close();

  const row = res.rows[0];
  if (!row) {
    throw new Error(
      `Missing dev account: ${email}. Run "pnpm sv seed" from the monorepo root first, then re-run this script.`,
    );
  }
  return { id: row.id as string, name: row.name as string, email: row.email as string };
}

// ---------------------------------------------------------------------------
// Fixed ids for every seeded row (prefixed `seed-tasks-`) — makes this
// script idempotent and `--reset` trivial: every list/task/view/subtask id
// is known up front, so a reset just deletes by id/listId rather than
// needing to track what a previous run created.
const LIST_GROCERIES = 'seed-tasks-list-groceries';
const LIST_WORK = 'seed-tasks-list-work';
const LIST_PERSONAL = 'seed-tasks-list-personal';
const LIST_SOMEDAY = 'seed-tasks-list-someday';
const LIST_HOME_RENO = 'seed-tasks-list-home-reno';
const SEED_LIST_IDS = [LIST_GROCERIES, LIST_WORK, LIST_PERSONAL, LIST_SOMEDAY, LIST_HOME_RENO];

const DAY_SEC = 24 * 60 * 60;

async function main(): Promise<void> {
  const user = await lookupDevUser();
  const client = namespacedClient(TASKS_NAMESPACE);
  const db = drizzle(client);

  if (RESET) {
    console.log('--reset: deleting prior seed data...');
    await db.delete(tasksItems).where(inArray(tasksItems.listId, SEED_LIST_IDS));
    await db.delete(tasksViews).where(inArray(tasksViews.listId, SEED_LIST_IDS));
    await db.delete(tasksLists).where(inArray(tasksLists.id, SEED_LIST_IDS));
  }

  const existing = await db
    .select({ id: tasksLists.id })
    .from(tasksLists)
    .where(eq(tasksLists.id, LIST_WORK));
  if (existing.length > 0) {
    console.log('Seed data already present (list "Work" exists) — nothing to do.');
    console.log('Run again with --reset to wipe and recreate it.');
    client.close();
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const secDaysAgo = (n: number): number => nowSec - n * DAY_SEC;

  let listCount = 0;
  let taskCount = 0;
  let subtaskCount = 0;

  async function addList(input: {
    id: string;
    title: string;
    color: string;
    sortOrder: number;
    createdAt: number;
  }): Promise<void> {
    await db.insert(tasksLists).values({
      id: input.id,
      tenantId: TENANT_ID,
      ownerId: user.id,
      title: input.title,
      color: input.color,
      sortOrder: input.sortOrder,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    // Every real list gets one default "List" view — see actions.ts's own
    // createList().
    await db.insert(tasksViews).values({
      id: `${input.id}-view`,
      tenantId: TENANT_ID,
      listId: input.id,
      ownerId: user.id,
      name: 'List',
      kind: 'list',
      config: '{}',
      isDefault: true,
      sortOrder: 0,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    });
    listCount++;
  }

  interface SubtaskSpec {
    id: string;
    title: string;
    done: boolean;
  }

  interface TaskSpec {
    id: string;
    listId: string;
    title: string;
    sortOrder: number;
    notes?: string;
    dueDate?: string;
    favorite?: boolean;
    /** Days ago this task was completed, or undefined for still-open. */
    completedDaysAgo?: number;
    recurrenceRule?: string;
    seriesId?: string;
    createdDaysAgo: number;
    subtasks?: SubtaskSpec[];
  }

  async function addTask(spec: TaskSpec): Promise<void> {
    const createdAt = secDaysAgo(spec.createdDaysAgo);
    const completedAt = spec.completedDaysAgo !== undefined ? secDaysAgo(spec.completedDaysAgo) : null;
    await db.insert(tasksItems).values({
      id: spec.id,
      tenantId: TENANT_ID,
      listId: spec.listId,
      parentId: null,
      title: spec.title,
      notes: spec.notes ?? null,
      favorite: spec.favorite ?? false,
      dueDate: spec.dueDate ?? null,
      dueTime: null,
      completedAt,
      sortOrder: spec.sortOrder,
      recurrenceRule: spec.recurrenceRule ?? null,
      seriesId: spec.seriesId ?? null,
      createdAt,
      updatedAt: createdAt,
    });
    taskCount++;

    for (const [i, sub] of (spec.subtasks ?? []).entries()) {
      await db.insert(tasksItems).values({
        id: sub.id,
        tenantId: TENANT_ID,
        listId: spec.listId,
        parentId: spec.id,
        title: sub.title,
        notes: null,
        favorite: false,
        dueDate: null,
        dueTime: null,
        completedAt: sub.done ? createdAt : null,
        sortOrder: i,
        recurrenceRule: null,
        seriesId: null,
        createdAt,
        updatedAt: createdAt,
      });
      subtaskCount++;
    }
  }

  // ---------------------------------------------------------------------
  // Groceries — a plain, low-friction list: no due dates or notes, one
  // already-completed item.
  // ---------------------------------------------------------------------
  await addList({ id: LIST_GROCERIES, title: 'Groceries', color: 'green', sortOrder: 0, createdAt: secDaysAgo(20) });
  await addTask({ id: 'seed-tasks-item-milk', listId: LIST_GROCERIES, title: 'Milk', sortOrder: 0, createdDaysAgo: 4 });
  await addTask({ id: 'seed-tasks-item-eggs', listId: LIST_GROCERIES, title: 'Eggs', sortOrder: 1, createdDaysAgo: 4 });
  await addTask({ id: 'seed-tasks-item-bread', listId: LIST_GROCERIES, title: 'Bread', sortOrder: 2, createdDaysAgo: 3 });
  await addTask({ id: 'seed-tasks-item-bananas', listId: LIST_GROCERIES, title: 'Bananas', sortOrder: 3, createdDaysAgo: 3, completedDaysAgo: 1 });
  await addTask({ id: 'seed-tasks-item-coffee', listId: LIST_GROCERIES, title: 'Coffee beans', sortOrder: 4, createdDaysAgo: 2 });

  // ---------------------------------------------------------------------
  // Work — the busy "kitchen sink" list: overdue, due-today + starred,
  // upcoming due dates, notes, a recurring task, a partial subtask parent,
  // a completed task, and a long-title task combining several of the above
  // at once.
  // ---------------------------------------------------------------------
  await addList({ id: LIST_WORK, title: 'Work', color: 'blue', sortOrder: 1, createdAt: secDaysAgo(18) });
  await addTask({
    id: 'seed-tasks-item-q3report',
    listId: LIST_WORK,
    title: 'Finish Q3 report',
    sortOrder: 0,
    notes: 'Include the revenue breakdown by region and flag the two overdue vendor invoices.',
    dueDate: addDaysISO(-2),
    createdDaysAgo: 6,
  });
  await addTask({
    id: 'seed-tasks-item-pr482',
    listId: LIST_WORK,
    title: 'Review pull request #482',
    sortOrder: 1,
    dueDate: todayISO(),
    favorite: true,
    createdDaysAgo: 1,
  });
  await addTask({
    id: 'seed-tasks-item-clientdemo',
    listId: LIST_WORK,
    title: 'Prepare for client demo',
    sortOrder: 2,
    notes: 'Walk through the new onboarding flow and the mobile carousel redesign.',
    dueDate: addDaysISO(3),
    createdDaysAgo: 5,
  });
  await addTask({
    id: 'seed-tasks-item-licenses',
    listId: LIST_WORK,
    title: 'Renew software licenses',
    sortOrder: 3,
    dueDate: addDaysISO(14),
    createdDaysAgo: 4,
  });
  await addTask({
    id: 'seed-tasks-item-statusupdate',
    listId: LIST_WORK,
    title: 'Send weekly status update',
    sortOrder: 4,
    dueDate: todayISO(),
    recurrenceRule: WEEKLY_MWF_RRULE,
    seriesId: 'seed-tasks-series-status',
    createdDaysAgo: 7,
  });
  await addTask({
    id: 'seed-tasks-item-onboarding',
    listId: LIST_WORK,
    title: 'Onboard new hire',
    sortOrder: 5,
    createdDaysAgo: 8,
    subtasks: [
      { id: 'seed-tasks-item-onboarding-1', title: 'Set up laptop', done: true },
      { id: 'seed-tasks-item-onboarding-2', title: 'Create accounts', done: true },
      { id: 'seed-tasks-item-onboarding-3', title: 'Schedule intro meetings', done: false },
      { id: 'seed-tasks-item-onboarding-4', title: 'Share onboarding doc', done: false },
    ],
  });
  await addTask({
    id: 'seed-tasks-item-cimigration',
    listId: LIST_WORK,
    title: 'Migrate CI pipeline to new runner',
    sortOrder: 6,
    createdDaysAgo: 10,
    completedDaysAgo: 3,
  });
  await addTask({
    id: 'seed-tasks-item-kitchensink',
    listId: LIST_WORK,
    title:
      'Kitchen sink task — quarterly planning doc with a really long title that should wrap or truncate depending on where it is rendered in the UI',
    sortOrder: 7,
    notes: 'Exercises a long title, a due date, starred, and a partially-complete subtask list all on one task.',
    dueDate: addDaysISO(6),
    favorite: true,
    createdDaysAgo: 9,
    subtasks: [
      { id: 'seed-tasks-item-kitchensink-1', title: 'Draft outline', done: true },
      { id: 'seed-tasks-item-kitchensink-2', title: 'Circulate for feedback', done: false },
      { id: 'seed-tasks-item-kitchensink-3', title: 'Finalize budget', done: false },
    ],
  });

  // ---------------------------------------------------------------------
  // Personal — notes, a second (more distant) overdue task, a 100%-done
  // subtask parent, and a couple of starred tasks in a different list from
  // Work's own starred entries (cross-list Starred view coverage).
  // ---------------------------------------------------------------------
  await addList({ id: LIST_PERSONAL, title: 'Personal', color: 'amber', sortOrder: 2, createdAt: secDaysAgo(15) });
  await addTask({
    id: 'seed-tasks-item-dentist',
    listId: LIST_PERSONAL,
    title: 'Book dentist appointment',
    sortOrder: 0,
    dueDate: addDaysISO(5),
    createdDaysAgo: 6,
  });
  await addTask({
    id: 'seed-tasks-item-atomichabits',
    listId: LIST_PERSONAL,
    title: 'Read "Atomic Habits"',
    sortOrder: 1,
    notes: 'Currently on chapter 4 — focus on the habit-stacking section.',
    favorite: true,
    createdDaysAgo: 12,
  });
  await addTask({
    id: 'seed-tasks-item-hike',
    listId: LIST_PERSONAL,
    title: 'Plan weekend hike',
    sortOrder: 2,
    createdDaysAgo: 5,
    subtasks: [
      { id: 'seed-tasks-item-hike-1', title: 'Check weather', done: true },
      { id: 'seed-tasks-item-hike-2', title: 'Pack backpack', done: true },
      { id: 'seed-tasks-item-hike-3', title: 'Charge camera', done: true },
    ],
  });
  await addTask({
    id: 'seed-tasks-item-callmom',
    listId: LIST_PERSONAL,
    title: 'Call mom',
    sortOrder: 3,
    favorite: true,
    createdDaysAgo: 2,
  });
  await addTask({
    id: 'seed-tasks-item-passport',
    listId: LIST_PERSONAL,
    title: 'Renew passport',
    sortOrder: 4,
    dueDate: addDaysISO(-20),
    createdDaysAgo: 25,
  });

  // ---------------------------------------------------------------------
  // Someday / Maybe — deliberately near-empty, to exercise that rendering
  // state next to the fuller lists above.
  // ---------------------------------------------------------------------
  await addList({ id: LIST_SOMEDAY, title: 'Someday / Maybe', color: 'grey', sortOrder: 3, createdAt: secDaysAgo(10) });
  await addTask({ id: 'seed-tasks-item-piano', listId: LIST_SOMEDAY, title: 'Learn to play piano', sortOrder: 0, createdDaysAgo: 10 });

  // ---------------------------------------------------------------------
  // Home Renovation — a second, larger subtask parent (2/5 done), an
  // upcoming due date further out, notes, and a second long title.
  // ---------------------------------------------------------------------
  await addList({ id: LIST_HOME_RENO, title: 'Home Renovation', color: 'red', sortOrder: 4, createdAt: secDaysAgo(9) });
  await addTask({
    id: 'seed-tasks-item-kitchenremodel',
    listId: LIST_HOME_RENO,
    title: 'Kitchen remodel',
    sortOrder: 0,
    createdDaysAgo: 9,
    subtasks: [
      { id: 'seed-tasks-item-kitchenremodel-1', title: 'Get contractor quotes', done: true },
      { id: 'seed-tasks-item-kitchenremodel-2', title: 'Pick countertop material', done: true },
      { id: 'seed-tasks-item-kitchenremodel-3', title: 'Order cabinets', done: false },
      { id: 'seed-tasks-item-kitchenremodel-4', title: 'Schedule electrician', done: false },
      { id: 'seed-tasks-item-kitchenremodel-5', title: 'Schedule plumber', done: false },
    ],
  });
  await addTask({
    id: 'seed-tasks-item-repaint',
    listId: LIST_HOME_RENO,
    title: 'Repaint living room',
    sortOrder: 1,
    dueDate: addDaysISO(30),
    createdDaysAgo: 7,
  });
  await addTask({
    id: 'seed-tasks-item-bathroomfixtures',
    listId: LIST_HOME_RENO,
    title: 'Replace bathroom fixtures',
    sortOrder: 2,
    notes: 'Compare quotes from the two plumbers before ordering fixtures.',
    createdDaysAgo: 6,
  });
  await addTask({
    id: 'seed-tasks-item-landscaping',
    listId: LIST_HOME_RENO,
    title:
      'Landscaping — front yard: remove old shrubs, lay new sod, install drip irrigation, and plant the new flower beds along the walkway',
    sortOrder: 3,
    createdDaysAgo: 4,
  });

  // ---------------------------------------------------------------------
  // Notification prefs — seeded enabled with a placeholder timezone so the
  // settings screen has a real configured state to show, not just the
  // never-visited default. onConflictDoNothing: this is a per-user
  // singleton (PK tenant_id+user_id, not a seed-prefixed id) — never
  // overwritten here, and never touched by --reset (see the module doc
  // comment above).
  await db
    .insert(tasksNotificationPrefs)
    .values({
      tenantId: TENANT_ID,
      userId: user.id,
      enabled: true,
      morningTime: '08:00',
      timezone: 'America/New_York',
      lastDigestDate: null,
      createdAt: nowSec,
      updatedAt: nowSec,
    })
    .onConflictDoNothing();

  client.close();

  console.log('Seed complete.');
  console.log(`  ${listCount} lists, ${taskCount} top-level tasks, ${subtaskCount} subtasks.`);
  console.log('');
  console.log(`Sign in as ${user.email} (password: sovereign) to see:`);
  console.log('  - Groceries, Work, Personal, Someday / Maybe, Home Renovation');
  console.log('  - An overdue task in Work ("Finish Q3 report") and a further-overdue one in Personal ("Renew passport")');
  console.log('  - A due-today, starred task in Work ("Review pull request #482")');
  console.log('  - A recurring task ("Send weekly status update", every Mon/Wed/Fri)');
  console.log('  - Starred tasks in both Work and Personal — check /tasks/starred');
  console.log('  - Subtask parents at 0%, partial, and 100% completion');
}

await main();
