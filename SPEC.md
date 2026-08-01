# Sovereign Tasks

**Version:** 0.3\
**Date:** June 2026\
**Author:** kasunben\
**Purpose:** Canonical specification for the Sovereign Tasks plugin — the single source of truth for its manifest, access model, data model, and build plan.\
**Status:** In Development

---

Sovereign Tasks is a privacy-first, self-hosted alternative to Google Tasks.
**Simplicity and minimalism are the core design principles** — the goal is a
cleaner, private Google Tasks, not a Todoist clone. Every feature decision is
measured against that bar: does it reduce friction without adding cognitive load?

The plugin is `type: sovereign` — a first-party plugin maintained in a separate
external repository (`sovereign-tasks`) and the primary reference
implementation for how an externally-maintained Sovereign plugin integrates with
the Sovereign SDK. `type: sovereign` means first-party/trusted distribution; it
does not require the source to live in the core platform monorepo.

## Current platform refresh (June 2026)

The platform has moved past several early assumptions in this draft:

- `sdk.db` is implemented; there should be no direct `packages/db` development
  path.
- Collaboration should wait for the proposed user-directory SDK (sv-RFC 0041)
  rather than calling admin user routes or building a private user directory.
- Tasks should participate in user data export/import and deletion through the
  plugin portability hook direction (sv-RFC 0052) once that platform surface is
  available.
- Tasks is a good candidate to expose read-only data contracts for approved
  consumers (sv-RFC 0002): lists, active tasks, overdue tasks, and assigned tasks.
- Mutating assistant/automation actions such as "create task" or "complete
  task" should wait for plugin tool contracts (sv-RFC 0047), not direct
  cross-plugin writes.

## Contents

- [Identity and manifest](#identity-and-manifest)
- [Access control](#access-control)
- [Functional requirements](#functional-requirements)
- [Directory structure](#directory-structure)
- [Data model](#data-model)
- [SDK dependencies](#sdk-dependencies)
- [Platform capability cross-reference](#platform-capability-cross-reference)
- [UI](#ui)
- [Build plan](#build-plan)
- [Open questions](#open-questions)
- [Changelog](#changelog)

---

## Identity and manifest

| Property                           | Value                                                   |
| ---------------------------------- | ------------------------------------------------------- |
| `id`                               | `fs.sovereign.tasks`                             |
| `name`                             | `Tasks`                                                 |
| `type`                             | `sovereign`                                             |
| `runtime`                          | `native`                                                |
| `routePrefix`                      | `/tasks`                                                |
| `shell`                            | `default`                                               |
| `adminOnly`                        | omitted (`false`)                                       |
| `icon`                             | `icon.svg`                                              |
| `permissions`                      | `auth:session`, `db:readWrite`                          |
| `repository`                       | `https://github.com/sovereignfs/sovereign-plugin-tasks` |
| `compatibility.minPlatformVersion` | `0.10.0`                                                |

`type: "sovereign"` is required. This plugin is first-party/trusted by the
Sovereign project but maintained outside the core monorepo. The manifest uses a
public HTTPS repository URL for install/registry metadata; developers may clone
the repo with SSH for manual contribution workflows.

Proposed `manifest.json`:

```json
{
  "schemaVersion": 1,
  "id": "fs.sovereign.tasks",
  "name": "Tasks",
  "version": "0.1.0",
  "description": "A minimal, privacy-first task manager.",
  "type": "sovereign",
  "runtime": "native",
  "routePrefix": "/tasks",
  "shell": "default",
  "icon": "icon.svg",
  "permissions": ["auth:session", "db:readWrite"],
  "repository": "https://github.com/sovereignfs/sovereign-plugin-tasks",
  "compatibility": {
    "minPlatformVersion": "0.10.0"
  }
}
```

## Access control

Tasks is available to authenticated users who can launch installed plugins. There
is no admin-only gate.

Within the plugin, v0.1 access is owner-scoped:

- **Tasks are private by default.** A user's lists and tasks are visible only to
  that user.
- Every query must scope by `tenant_id` and current user ownership.
- Sharing, membership, and assignment are deferred until the collaboration
  milestone, after `sdk.directory` is available.

Collaboration hard rules for the later sharing milestone:

- A user can read a shared list only if they are in `tasks_list_members`.
- A member can create/edit/complete tasks within a list.
- Only the owner can rename/delete/share/unshare the list.
- Members can leave a shared list. The owner cannot leave without transferring
  ownership or deleting the list.
- Assignment targets must be current list members.
- Removing a member auto-unassigns their tasks (`assignee_id` → `null`).

## Functional requirements

Requirements are versioned to their milestone. IDs are stable — never renumber
or reuse a TSK-\* id.

### v0.1 — POC/Core private tasks

| ID     | Requirement                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------- |
| TSK-01 | Create, rename, and delete lists.                                                                         |
| TSK-02 | Lists have an optional color for visual distinction.                                                      |
| TSK-03 | Deleting a list deletes all tasks within it.                                                              |
| TSK-04 | Create, edit, and delete tasks within a list.                                                             |
| TSK-05 | Tasks have: title (required), notes (optional free text), and sort order.                                 |
| TSK-06 | Subtasks — one level deep. Subtasks cannot themselves have subtasks.                                      |
| TSK-07 | Mark a task (and all its subtasks) complete, or reopen a completed task.                                  |
| TSK-08 | Manual sort order via drag-reorder within a list.                                                         |
| TSK-09 | Show/hide completed tasks toggle per user. Completed tasks are hidden by default; manual delete required. |

### v0.2 — Collaboration

Requires `sdk.directory` (sv-RFC 0041) or an accepted equivalent user/member
selection surface. Do not call Console/admin user routes.

| ID     | Requirement                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------ |
| TSK-10 | Share a list with existing users on the instance. Roles: `owner` and `member`.                         |
| TSK-11 | Remove a member from a shared list. Their assigned tasks are auto-unassigned.                          |
| TSK-12 | Transfer list ownership to another member.                                                             |
| TSK-13 | Assign a task to any member within a shared list.                                                      |
| TSK-14 | Shared-list authorization follows membership rules for reads and owner-only rules for list management. |

### v0.3 — Due dates and power-user features

| ID     | Requirement                                                                             |
| ------ | --------------------------------------------------------------------------------------- |
| TSK-15 | Add a due date to a task (date only, or date and time). Due time requires a due date.   |
| TSK-16 | Overdue tasks (past due date, not completed) are visually distinguished.                |
| TSK-17 | Filter tasks within a list: All / Active / Completed / Overdue.                         |
| TSK-18 | Cross-list search by task title.                                                        |
| TSK-19 | Keyboard shortcuts for common actions: new task, complete task, navigate between lists. |
| TSK-20 | Bulk select tasks and delete selected.                                                  |
| TSK-21 | Bulk select tasks and move selected to another list.                                    |
| TSK-26 | Star/favourite a task (toggle on the row and in the detail pane). Added ahead of phasing. |
| TSK-27 | Move a single task to a different list from the detail pane's List field. Subtasks move with their parent. Added ahead of phasing — distinct from TSK-21's bulk move. |
| TSK-28 | A virtual "Starred" list, pinned first on the lists surface, aggregating every starred task across the user's lists in one view (sorted by due date). Not a real list — owns no `tasks_lists` row and no tasks; each task always remains in (and displays) its source list. No add-task, drag-reorder, rename/colour/delete, or bulk select in this view. Added ahead of phasing; builds on TSK-26. |
| TSK-29 | Account-level data portability (sv-RFC 0007 export/import, sv-RFC 0033 deletion) — no plugin-local UI; reached from Account → Export/Import my data. Export includes owned lists, items, views, and prefs; import is additive and remaps every plugin-owned id; deletion removes everything the user owns. Added ahead of phasing. |

### v0.4 — Recurrence

Recurrence is implemented using the `rrule` npm package (sv-RFC 5545 RRULE). No
custom recurrence logic is written.

| ID     | Requirement                                                                                                                                                                                                   | Status |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| TSK-22 | Set a recurrence rule on a task. Supported patterns: daily; weekly; monthly; yearly; every N days; every N weeks; specific weekdays (e.g. Mon + Wed + Fri); nth day of month (e.g. last Friday of the month). | ⚠️ Shipped minus "nth day of month" — matches Google Tasks' own repeat picker as the v1 reference; deferred as the most complex picker UI for the fewest real cases. |
| TSK-23 | Completing a recurring task marks it done and generates a new sibling task for the next occurrence (same `series_id`, `recurrence_rule`, list, and assignee).                                                 | ✅ New instance starts with no subtasks — not mentioned in this requirement's own wording, and carrying forward a partially-done checklist indefinitely is ambiguous. |
| TSK-24 | Editing a recurring task prompts the user: edit this instance only / this and all future instances / all instances.                                                                                           | ✅ Gates title, notes, due date, and the recurrence rule itself. Star, list-move, and delete act on the single instance only — not meaningfully series-wide concepts. Due-date "future/all" scope propagates the *time* only; each occurrence keeps its own calendar date (overwriting every occurrence's date to one literal value would collapse the series). |
| TSK-25 | Recurring tasks display their recurrence pattern (human-readable summary) in the task UI.                                                                                                                     | ✅ Detail pane (full text via `rrule`'s `.toText()`) and a small repeat icon on the task row (`Icon name="rotate-ccw"` — closest match in `packages/ui`; no dedicated icon exists there). |

## Directory structure

The plugin lives in its own external repository. Structure follows the standard
plugin layout (SRS §2.3).

```
sovereign-tasks/
├── manifest.json
├── icon.svg                    # Tasks icon — sidebar middle section + Launcher grid
├── app/
│   ├── layout.tsx              # tasks shell — list sidebar + content area
│   ├── page.tsx                # lists overview (all lists, new list CTA)
│   └── [listId]/
│       └── page.tsx            # tasks in a list
├── db/
│   └── schema.ts               # tasks_lists, tasks_user_list_prefs, tasks_items
├── migrations/                 # Drizzle migration files
├── components/
│   ├── TaskItem.tsx            # individual task row
│   ├── SubtaskList.tsx         # subtask expansion
│   ├── BulkActionBar.tsx       # bulk select/delete/move (v0.3)
│   └── RecurrenceEditor.tsx    # recurrence pattern editor (v0.4)
├── lib/
│   └── recurrence.ts           # rrule helpers: next occurrence, rule → human string
└── package.json
```

## Data model

Tables are all prefixed `tasks_`. All carry `tenant_id` per the platform
architectural rule.

v0.1 ships only private, owner-scoped lists and tasks. Collaboration columns and
tables are added in v0.2, due-date columns in v0.3, and recurrence columns in
v0.4. View metadata is included early so future layouts (Kanban Compact, Kanban,
Visualizer) can be added without changing the core list and task ownership model.

### `tasks_lists`

| Column       | Type      | Notes                                      |
| ------------ | --------- | ------------------------------------------ |
| `id`         | uuid / pk |                                            |
| `tenant_id`  | string    |                                            |
| `owner_id`   | string    | The user who created/owns the list.        |
| `title`      | string    |                                            |
| `color`      | string?   | Nullable. See open question 1.             |
| `sort_order` | integer   | Owner's preferred list order.              |
| `created_at` | timestamp |                                            |
| `updated_at` | timestamp |                                            |

Deletes are hard deletes in v0.1: deleting a list deletes all tasks in that
list. Soft delete/trash is out of scope.

### `tasks_user_list_prefs`

Stores per-user preferences that should not be global list state.

| Column           | Type      | Notes                                                              |
| ---------------- | --------- | ------------------------------------------------------------------ |
| `tenant_id`      | string    |                                                                    |
| `user_id`        | string    |                                                                    |
| `list_id`        | uuid      | FK → `tasks_lists`.                                                |
| `show_completed` | boolean   | Defaults to `false`.                                               |
| `default_view_id`| uuid?     | Nullable. FK → `tasks_views`; falls back to the list's base view.  |
| `created_at`     | timestamp |                                                                    |
| `updated_at`     | timestamp |                                                                    |

Composite PK: (`tenant_id`, `user_id`, `list_id`).

### `tasks_views`

Stores saved list presentation modes. v0.1 only needs one system-created list
view per list, but the table reserves a stable place for later view variants
without overloading list or task rows.

| Column       | Type      | Notes                                                                                 |
| ------------ | --------- | ------------------------------------------------------------------------------------- |
| `id`         | uuid / pk |                                                                                       |
| `tenant_id`  | string    |                                                                                       |
| `list_id`    | uuid      | FK → `tasks_lists`.                                                                   |
| `owner_id`   | string    | User who created the view.                                                            |
| `name`       | string    | Display name, e.g. "Compact", "Kanban Compact", "Kanban", "Visualizer".               |
| `kind`       | string    | `compact`, `kanban_compact`, `kanban`, `visualizer`, or future registered variants.   |
| `config`     | json      | View-specific config; defaults to `{}`.                                                |
| `is_default` | boolean   | At most one default per list; user prefs may override it.                              |
| `sort_order` | integer   | View tab/order within a list.                                                         |
| `created_at` | timestamp |                                                                                       |
| `updated_at` | timestamp |                                                                                       |

View rules:

- The initial v0.1 UI renders only `kind: "compact"` (the Compact view).
- Future view kinds must be additive and must not require changing the
  `tasks_items` ownership or completion model.
- View-specific grouping, columns, filters, or visualization state lives in
  `tasks_views.config`, not in task rows, unless the concept is core task data.
- Shared-list view visibility follows list membership in v0.2+; private lists
  remain visible only to the owner.

### `tasks_list_members` (v0.2)

| Column      | Type                | Notes                                                 |
| ----------- | ------------------- | ----------------------------------------------------- |
| `list_id`   | uuid                | FK → `tasks_lists`.                                   |
| `tenant_id` | string              |                                                       |
| `user_id`   | string              |                                                       |
| `role`      | `owner` \| `member` | Owner row is inserted automatically on list creation. |
| `joined_at` | timestamp           |                                                       |

Composite PK: (`tenant_id`, `list_id`, `user_id`).

Owner invariant: exactly one owner row must exist for every shared list. Private
v0.1 lists may omit membership rows entirely until collaboration lands.

### `tasks_items`

| Column            | Type       | Notes                                                                              |
| ----------------- | ---------- | ---------------------------------------------------------------------------------- |
| `id`              | uuid / pk  |                                                                                    |
| `tenant_id`       | string     |                                                                                    |
| `list_id`         | uuid       | FK → `tasks_lists`.                                                                |
| `parent_id`       | uuid?      | Nullable. FK → `tasks_items`. Presence = subtask. One level enforced at app layer. |
| `assignee_id`     | string?    | Nullable. Added v0.2. Only meaningful within shared lists.                         |
| `title`           | string     |                                                                                    |
| `notes`           | text?      | Nullable.                                                                          |
| `favorite`        | boolean    | Starred flag. Default false. Surfaced as the star toggle.                          |
| `due_date`        | date?      | Nullable. Added v0.3.                                                              |
| `due_time`        | time?      | Nullable. Requires `due_date`. Added v0.3.                                         |
| `completed_at`    | timestamp? | Nullable. Set on completion, cleared on reopen.                                    |
| `sort_order`      | integer    |                                                                                    |
| `recurrence_rule` | string?    | Nullable. RRULE string (sv-RFC 5545). Added v0.4.                                     |
| `series_id`       | uuid?      | Nullable. Shared across all instances of a recurring series. Added v0.4.           |
| `created_at`      | timestamp  |                                                                                    |
| `updated_at`      | timestamp  |                                                                                    |

Authorization invariant: every item operation must verify the current user owns
the list in v0.1, or is a member of the list in v0.2+.

**Recurrence mechanics:** When a recurring task is completed, `completed_at` is
set and a new sibling row is inserted with the same `list_id`, `recurrence_rule`,
`series_id`, and `assignee_id`, and with `due_date` advanced to the next
occurrence as calculated by `rrule`. The `series_id` enables "edit this and all
future" (filter by `series_id` + `due_date >= this task's due_date`) and "edit
all" (filter by `series_id` only).

## SDK dependencies

| SDK surface       | Used for                                             | Available from           |
| ----------------- | ---------------------------------------------------- | ------------------------ |
| `sdk.auth`        | Current user session                                 | Stable                   |
| `sdk.db`          | Read/write all tasks tables                          | Stable                   |
| `sdk.directory`   | User lookup for sharing and assignment               | sv-RFC 0041; required v0.2  |
| `sdk.data`        | Expose read-only task/list contracts to consumers    | sv-RFC 0002; optional v0.3+ |
| `sdk.portability` | Export/import/delete participation                   | sv-RFC 0052; optional v1.0  |
| `sdk.tools`       | Future mutating actions such as create/complete task | sv-RFC 0047; post-v1        |

Tasks requires no `sdk.mailer` or `sdk.platform` in v1.

## Platform capability cross-reference

Tasks should lean on existing platform capabilities instead of creating private
plugin-specific substitutes.

| Platform capability            | Tasks usage                                                                  | Status / reference                |
| ------------------------------ | ---------------------------------------------------------------------------- | --------------------------------- |
| Authenticated plugin sessions  | Scope every list/task query to the current user and tenant.                   | Stable `sdk.auth`                 |
| Plugin-owned database access   | Store all Tasks domain tables through the plugin DB surface.                  | Stable `sdk.db`                   |
| User/member selection          | Select users for list sharing and task assignment.                            | sv-RFC 0041, required before v0.2    |
| Cross-plugin data sharing      | Expose read-only task/list contracts to approved consumers.                   | sv-RFC 0002, optional after v0.1     |
| Plugin portability hooks       | Export/import/delete Tasks data through Account-level orchestration.          | sv-RFC 0052, target before v1.0      |
| Plugin tool contracts          | Future assistant/automation actions such as create or complete task.          | sv-RFC 0047, post-v1                 |
| Activity logging               | Optional future audit entries for collaboration/share mutations if warranted. | sv-RFC 0005, not required for v0.1   |
| Notifications                  | Due/overdue notifications shipped (v0.11): morning digest + due-time reminders via the platform scheduler. Assignment notifications remain future (v0.2+). | sv-RFC 0015/0016/0046               |
| Plugin capabilities/roles      | Future gates for advanced collaboration or admin-style actions if needed.     | sv-RFC 0021/0022, not required v0.1  |

### Data contracts

Candidate read-only contracts, after sv-RFC 0002 integration is ready:

| Contract            | Version | Shape                                                  |
| ------------------- | ------- | ------------------------------------------------------ |
| `tasks.lists`       | 1       | Lists visible to the current user.                     |
| `tasks.active`      | 1       | Active tasks with list, assignee, due date, and notes. |
| `tasks.overdue`     | 1       | Overdue tasks visible to the current user.             |
| `tasks.assignments` | 1       | Tasks assigned to the current user.                    |

### Portability and deletion (TSK-29, shipped)

Full Account-level portability, via sv-RFC 0007 (export/import) and sv-RFC
0033 (deletion) — no plugin-local UI; reached from Account → Export my
data / Import my data. See `app/_lib/portability.ts` and `CLAUDE.md`'s "Data
portability" section for the implementation.

Export includes every list the user owns, its items (top-level and
subtasks), views, and per-list prefs, plus the user's own (list-independent)
notification prefs. Import restores additively (never wipes existing data)
and remaps every plugin-owned id (lists, views, items, and — since it's a
grouping value rather than a literal FK — recurring-series ids too), skipping
any row whose cross-reference isn't actually part of the export instead of
hard-failing.

Deletion policy — v0.1's ownership model is single-owner only (v0.2
collaboration is still blocked on `sdk.directory`), so this is simpler than a
shared-list scheme would need: every list the user owns, and everything in
it, is deleted; so is the user's own notification-prefs row. Revisit once
v0.2 ships shared lists.

## UI

Tasks consumes `@sovereignfs/ui` (components and `--sv-*` tokens) exclusively —
no hardcoded colours, spacing, or radii.

**Layout:** Three-column on web — list sidebar (col 1) · task list (col 2) ·
task detail (col 3). The detail pane is driven by the `?task=<id>` search param
on `/tasks/[listId]` and collapses below ~900px; the task list and detail keep
recessed grey flanks around a white centre pane. The plugin renders full-bleed
via `data-plugin-fullbleed` (the shell drops its content padding for opted-in
plugins). Tablet (641–900px) keeps this same layout with the detail pane
hidden — unchanged, and out of scope for the mobile UI below.

**Mobile (≤640px):** not a squeeze of the desktop layout — a horizontally
swipeable carousel. Slide 0 is a full-page Lists index (the sidebar's mobile
equivalent); each following slide is one full list. Opening the app lands on
the user's first list, not the index; swiping right reveals the index,
swiping left advances through lists. Task detail and list-management actions
(rename, colour, delete-entry-point) open as bottom sheets instead of a fixed
column or popover menu — delete's own confirmation stays a centered dialog at
every breakpoint. See `CLAUDE.md`'s "Mobile shell" section for the
implementation model (why the carousel manages its own data independently of
`page.tsx`'s server fetch, and how `router.refresh()` still reaches it).

**Views:** v0.1 renders the **Compact** view only (`kind: "compact"`) — a focused
linear list. The data model reserves saved view metadata for three later variants:
**Kanban Compact** (`kanban_compact`), **Kanban** (`kanban`), and **Visualizer**
(`visualizer`). Those variants are not part of v0.1.

**Primitives.** The strike-through checkbox comes from `packages/ui`
(`Checkbox`). Drag reorder (lists and tasks) uses a custom in-plugin floating
overlay handle (`GripIcon`), not `packages/ui`'s `DragHandleRow` — that
component reserves a fixed-width gutter before the row's content, which
couldn't be made to align with the header/add-row indent above it; the
floating handle occupies no layout space until hovered. The due-date control is
a `Popover` combining quick-date buttons, an in-plugin `CalendarGrid` (month
view — no calendar component exists in `packages/ui`), and — only once a date
is set — a native `<input type="time">`. The subtask progress ring and the
calendar icon are small in-plugin SVGs. All of these are kept local until a
second consumer justifies promoting them to `packages/ui`. Still likely to
belong in `packages/ui` when their milestones land: a bulk action bar (floating,
appears on selection; v0.3 bulk actions) and a recurrence pattern editor (v0.4).
Drive those into `packages/ui` rather than building them inline — they are
broadly reusable across plugins.

## Build plan

Five milestones, each a separate branch + PR in the `sovereign-tasks` repo.
Requires Sovereign platform ≥ v0.10.0.

### v0.1 — POC/Core private tasks (TSK-01–09)

Private lists, task CRUD, subtasks, notes, manual sort, show/hide completed, and
strict current-user data isolation. This milestone proves the external
`type: sovereign` plugin path, manifest/install/generate flow, `sdk.db`, and a
minimal task UI before collaboration adds platform dependencies.

**Done when:** A user can create lists, add tasks and subtasks, complete and
reopen tasks, reorder tasks, hide/show completed tasks, and never see another
user's data.

### v0.2 — Collaboration (TSK-10–14)

List sharing with owner/member roles and basic task assignment within shared
lists. Requires `sdk.directory` or an accepted equivalent.

**Done when:** A user can share a list with another active instance user,
transfer ownership, remove a member, and assign tasks only to current list
members.

### v0.3 — Due dates and power-user features (TSK-15–21)

Due date + time, overdue distinction, filtering (All / Active / Completed /
Overdue), cross-list search, keyboard shortcuts, bulk delete and move.

**Verified:** Keyboard shortcuts (`n`/`j`·`k`/`e`/`Enter`/`[`·`]`) are scoped to
the task-list pane and skip while focus is in a text field, so they never
fight with typing. Bulk select is entered via ctrl/cmd-click or long-press on
a row rather than an explicit "Select" mode toggle, since the row checkbox
already means "mark complete" — a second, distinct trigger avoids that clash.
Bulk delete and move run as dedicated server actions (`bulkDeleteTasks`,
`bulkMoveTasks`) rather than N sequential single-task calls, for one DB round
trip per table instead of one per selected task.

**Done when:** Tasks with due dates surface correctly in filters and overdue
styling; keyboard shortcuts cover the core actions; bulk select operates on
multiple tasks in one action.

### v0.4 — Recurrence (TSK-22–25) — shipped ahead of phasing

Common patterns via the `rrule` package (daily/weekly/monthly/yearly, every-N,
specific weekdays), matching Google Tasks' own repeat picker; "nth day of
month" deferred. Generate-next-instance model on completion. Edit-this /
this-and-future / all modes, gated to title/notes/due-date/recurrence-rule
edits only. Human-readable rule display.

**Verified:** `rrule` operates on UTC internally — constructing its `dtstart`
(or any date passed to `.after()`) from a *local* `new Date(y, m, d)` silently
shifts which weekday matches a `byweekday` rule by one day on servers with a
positive UTC offset (caught via a throwaway smoke-test script before wiring
into server actions, per the task's own verification step). `recurrence.ts`
constructs and reads back every rrule-facing date via `Date.UTC(...)` /
`getUTC*()`, not this plugin's own local-date helpers in `date.ts`.

**Done when:** A recurring task generates a correctly-dated next instance on
completion; editing a recurring task presents the three-mode prompt; the
recurrence pattern displays legibly in the task UI.

### v1.0 — Stable

Polish, documentation, plugin developer guide reference. No new features; no
scope expansion. The Tasks plugin is the primary reference implementation for
external plugin developers.

## Open questions

1. **List color palette.** ✅ **Resolved.** A fixed set of swatches derived from
   `--sv-*` primitive tokens (theme-safe, consistent) over arbitrary hex. Shipped
   as `LIST_SWATCHES` in `app/_lib/colors.ts` (black/grey/green/blue/amber/red); the
   stored value is the swatch key and renders only as the small list dot.
2. **Assignment notifications.** In-app notification when a task is assigned to
   you is out of scope for v1 but the data model must not preclude it. Note for
   v1.1 planning.
3. **Google Tasks import.** Google Takeout exports Tasks as JSON. An import tool
   would lower the migration barrier for the target user. Out of scope v1; flag
   as a v1.1 candidate.

## Changelog

| Version | Date     | Change                                                                              |
| ------- | -------- | ----------------------------------------------------------------------------------- |
| 0.6     | Jul 2026 | Recurrence (TSK-22–25) shipped ahead of the roadmap's own ordering — daily/weekly/monthly/yearly/every-N/specific-weekdays patterns (matching Google Tasks' picker; "nth day of month" deferred), generate-next-instance on completion, a three-way edit-scope prompt (this/future/all) gated to title/notes/due-date/recurrence-rule, and a human-readable pattern shown in both the detail pane and a row icon. |
| 0.5     | Jul 2026 | Detail-pane polish: custom `CalendarGrid` due-date picker (replacing the native date input), a List field to move a task to a different list (TSK-27), boxed subtask cards with a count label, delete-task confirmation styling. Sidebar drag-reorder for lists, floating (non-reserved-gutter) drag handles replacing `DragHandleRow` in both the sidebar and task rows, and a fix for `@dnd-kit`'s `DndContext` SSR/hydration ID mismatch (explicit `id` prop on both contexts). |
| 0.4     | Jul 2026 | Three-column web home (lists · tasks · detail); due dates, filters, cross-list search, and a `favorite` column landed ahead of the original phasing. Collaboration and recurrence remain deferred. |
| 0.3     | Jun 2026 | Narrowed v0.1 to private tasks; moved collaboration after user-directory support.   |
| 0.2     | Jun 2026 | Added manifest `icon` field; added missing `tenant_id` to `tasks_list_members`.     |
| 0.1     | Jun 2026 | Initial draft — feature set designed from Google Tasks analysis and design session. |
