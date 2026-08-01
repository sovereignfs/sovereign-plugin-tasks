# Sovereign Tasks

A minimal, privacy-first task manager for [Sovereign](https://github.com/sovereignfs/sovereign).

**Status:** v0.11.0 — active development  
**Plugin ID:** `fs.sovereign.tasks`  
**Route:** `/tasks`

---

## What it is

A clean, self-hosted alternative to Google Tasks. The UI is intentionally minimal and will support multiple layouts — starting with **Compact** (a focused list view), with Kanban and Visualizer views planned for later milestones.

On the web it's a **three-column home**: list sidebar · task list · task detail. Tasks support subtasks (one level deep), optional notes, completion, manual drag-reorder (lists and tasks), **due dates** (via a custom calendar picker, with overdue styling), **recurrence** (daily/weekly/monthly/yearly/every-N/specific weekdays, matching Google Tasks' own repeat picker), a **star/favourite** toggle, per-list **filters** (All / Active / Overdue) with a collapsible Completed section, **cross-list search**, per-list **colour**, **keyboard shortcuts** for the common actions, and **bulk select** (ctrl/cmd-click or long-press a row) to delete or move several tasks at once. The detail pane (opened by selecting a task) is where notes, due date, repeat, subtasks, and a task's **list** (move it to a different list) are edited.

On mobile it's a different UI, not a squeeze of the desktop one: a horizontally **swipeable carousel** — a Lists index slide, then one slide per list, landing on your first list when you open the app — with task detail and list management (rename, colour, delete) opening as **bottom sheets** instead of a fixed column or popover.

Sovereign Tasks runs on your own Sovereign instance. Users sign in with their Sovereign account; data is stored on and synced through your instance server.

See [CONCEPT.md](CONCEPT.md) for design philosophy and [roadmap.md](roadmap.md) for the milestone plan.

## Installing on a Sovereign instance

```bash
sv plugin add https://github.com/sovereignfs/sovereign-plugin-tasks
```

Then restart the runtime. Tasks will appear in the launcher as **Tasks**.

## Local development

The plugin is developed as a `.local` workspace member inside the platform monorepo.

```bash
# From the platform monorepo root
pnpm dev   # runtime on :3000; plugin routes live at /tasks
```

After changing the database schema (`app/_db/schema.ts`), hand-author a matching
migration — there is no generate step. Add a numbered SQL file under
`migrations/sqlite/` following the existing files (e.g. `0001_add_favorite.sql`),
append an entry to `migrations/sqlite/meta/_journal.json`, then apply it without
restarting the dev server:

```bash
sv plugin migrate fs.sovereign.tasks
```

See the [plugin development guide](../../docs/plugin-development.md) for the full workflow.

## Stack

- **Language:** TypeScript, React (Next.js App Router)
- **Database:** shared platform database via `sdk.db` — no direct `@sovereignfs/db` imports
- **UI:** `@sovereignfs/ui` components and `--sv-*` tokens exclusively
- **Drag reorder:** `@dnd-kit/core` + `@dnd-kit/sortable`

## Requirements

- Sovereign platform ≥ `0.10.0`
- Node ≥ 20
- pnpm 11.5.x (platform monorepo convention)

## Spec

Full functional requirements, data model, and milestone definitions: [SPEC.md](SPEC.md)

## License

AGPL-3.0-or-later — same license as the [Sovereign platform](https://github.com/sovereignfs/sovereign). See [LICENSE](LICENSE).
