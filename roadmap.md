# Roadmap — Sovereign Tasks

Requirement IDs (TSK-*) are stable — never renumbered or reused. Full requirement details live in the spec (`tasks.md`).

## v0.1 — Core private tasks (current)

Private lists and tasks for a single user. No sharing.

| ID | Requirement | Status |
| --- | --- | --- |
| TSK-01 | Create, rename, and delete lists | ✅ |
| TSK-02 | List color for visual distinction | ✅ |
| TSK-03 | Deleting a list deletes all tasks within it | ✅ |
| TSK-04 | Create, edit, and delete tasks | ✅ |
| TSK-05 | Tasks have title (required) and notes (optional) | ✅ |
| TSK-06 | Subtasks — one level deep | ✅ |
| TSK-07 | Mark task (and subtasks) complete / reopen | ✅ |
| TSK-08 | Manual drag-reorder within a list | ✅ |
| TSK-09 | Show/hide completed tasks toggle per user | ✅ |

## v0.2 — Collaboration

**Blocked on `sdk.directory` (sv-RFC 0041).** Do not start until the user-directory SDK surface is available.

TSK-10 through TSK-14: shared lists, membership roles, task assignment, member removal.

## v0.3 — Due dates and power-user features

Due dates, filters, and cross-list search landed early — alongside the
three-column web home — ahead of the original phasing. Keyboard shortcuts and
bulk actions shipped after recurrence (v0.4), which itself jumped the queue —
completing this milestone.

| ID | Requirement | Status |
| --- | --- | --- |
| TSK-15 | Due date (date, or date + time) | ✅ |
| TSK-16 | Overdue tasks visually distinguished | ✅ |
| TSK-17 | Filter: All / Active / Overdue, plus a Completed section | ✅ |
| TSK-18 | Cross-list search by task title | ✅ |
| TSK-19 | Keyboard shortcuts for common actions | ✅ |
| TSK-20 | Bulk select + delete | ✅ |
| TSK-21 | Bulk select + move to another list | ✅ |
| TSK-26 | Star/favourite a task (added ahead of phasing) | ✅ |
| TSK-27 | Move a single task to a different list from the detail pane (added ahead of phasing; distinct from TSK-21's bulk move) | ✅ |
| TSK-28 | Virtual "Starred" list — aggregates every starred task across lists in one pinned view (added ahead of phasing; builds on TSK-26) | ✅ |
| TSK-29 | Account-level data portability — export/import (sv-RFC 0007) and deletion (sv-RFC 0033) via Account → Export/Import my data, no plugin-local UI (added ahead of phasing) | ✅ |
| TSK-30 | Today's Agenda — swipeable triage view (mobile-first) over due-today/overdue/starred tasks (added ahead of phasing) | ✅ |

Keyboard shortcuts (scoped to the task-list pane, skipped while typing in a
field): `n` focuses the add-task input, `j`/`k` (or Up/Down) move a keyboard
focus ring between rows, `e` completes the focused row, `Enter` opens its
detail pane, and `[`/`]` switch to the previous/next list. Bulk selection is
entered via ctrl/cmd-click (desktop) or long-press (touch) on a row — deliberately
not an explicit "Select" mode button, since the row checkbox already means
"mark complete" and this keeps that meaning unambiguous. A floating action bar
appears with the selection count plus Move to list / Delete / Cancel; `Escape`
also clears the selection.

Starred (TSK-28) is a reserved pseudo-list id (`'starred'`, guaranteed not to
collide with a real list's UUID) rendered as a pinned row above the sortable
list sidebar and reachable at `/tasks/starred` (desktop) or a synthetic
carousel slide right after the Lists index (mobile). It reuses `TasksPane` in
a stripped-down "virtual" mode — no add-task row, no drag-reorder (no
cross-list manual order exists), no rename/colour/delete-list, and no bulk
select (`bulkDeleteTasks`/`bulkMoveTasks` are scoped to one owning list, which
an aggregated view doesn't have) — rather than a separate component, so every
other list behavior (filter, sort by due date/title/created, complete,
un-star, open detail, move to another list from the detail pane) comes free
and stays in sync. See `CLAUDE.md`'s "Drag reorder" and "Mobile shell"
sections for how the underlying mechanisms this reuses work.

Data portability (TSK-29) wires this plugin into the platform's existing
account-level export/import/deletion flow (sv-RFC 0007 / sv-RFC 0033) — a
new `app/_lib/portability.ts`, registered from `layout.tsx`, mirroring
`sovereign-plainwrite`'s own. No new UI in this plugin; the platform side
(runtime orchestration, API routes, manifest-permission gating) already
generically supported any registering plugin, so this was a single new file
plus two manifest permissions (`data:export`, `data:import`). See
`CLAUDE.md`'s "Data portability" section.

## v0.4 — Recurrence

Landed out of the roadmap's own order — jumped ahead of v0.3's remaining
keyboard-shortcut/bulk-action items since recurring tasks were judged more
important. `recurrence_rule`/`series_id` columns already existed on
`tasks_items` since the very first migration, so no schema change was needed.

| ID | Requirement | Status |
| --- | --- | --- |
| TSK-22 | Set a recurrence rule (daily/weekly/monthly/yearly/every-N/specific weekdays) | ✅ (nth-day-of-month deferred) |
| TSK-23 | Completing a recurring task generates the next occurrence | ✅ (no subtasks copied) |
| TSK-24 | Edit-scope prompt: this / this and future / all | ✅ (title/notes/due-date/rule only) |
| TSK-25 | Human-readable recurrence pattern in the task UI | ✅ |

## Mobile UI — swipeable lists carousel + bottom sheets

Cross-cutting UI work, not tied to a specific TSK id (like "Layout" in the
spec, this is described in prose rather than a numbered requirement). Shipped
ahead of v1.0's "full keyboard navigation" polish pass, following the same
pattern as TSK-26/27 and v0.4 jumping the queue.

Below 640px the plugin now renders a genuinely different UI, not a squeeze of
the desktop three-column layout: a swipeable carousel (Lists index slide,
then one slide per list — landing on the user's first list, not the index)
and bottom sheets for task detail and list management (rename/colour/delete
entry point; delete's own confirmation stays a centered dialog). Desktop and
tablet (641–900px) are unchanged. See `CLAUDE.md`'s "Mobile shell" section for
the implementation model.

## v0.11 — Due/overdue notifications

Shipped ahead of v1.0, following the same queue-jumping pattern as v0.4 and
the mobile UI work. First consumer of the platform's plugin scheduler
(sv-RFC 0046 Phase 1) and of `sdk.notifications.send` (sv-RFC 0015/0016 —
in-app bell plus Web Push when the instance has VAPID configured and the
user enabled push for a device).

Per-user and opt-in (bell icon in the list sidebar header): a once-per-day
**morning digest** ("3 tasks due today · 2 overdue") at a user-chosen local
time, plus a **due-time reminder** per task whose `due_time` arrives.
Computed in the user's browser-captured IANA timezone; every send is gated
behind a conditional-UPDATE claim so scheduler restarts/replicas can't
double-send. See `CLAUDE.md`'s "Due/overdue notifications" section.

## v0.12 — Mobile drag-reorder

Shipped ahead of v1.0, same queue-jumping pattern as v0.4/v0.11. Fixes a
mobile gap left by the hover-only drag handle: below 640px there was
previously no way to reorder lists or tasks at all
(`pointer-events: none` on the handle under `@media (hover: none)`,
deliberately, since a touch drag from an invisible corner would otherwise
fight scrolling). Both the Lists slide and task rows are now
long-press-to-drag on touch — a still hold lifts the row; moving it reorders,
releasing it back in place on a task row toggles bulk-select (the same
outcome `useLongPress` already gave, just resolved at release instead of
mid-hold when a reorder is actually possible). See `CLAUDE.md`'s "Drag
reorder" section for the sensor/exclusion mechanism.

## Sticky list header + add-task row

Shipped ahead of v1.0, cross-cutting UI work not tied to a specific TSK id
(like the Mobile UI carousel entry above). The list title/⋯-menu header and
the "Add a task…" input used to scroll away with the rest of the list on a
long list — both are now pinned to the top of `TasksPane` on every
breakpoint via `position: sticky`, with an opaque background sourced from a
`--tasks-pane-bg` custom property (mirroring `TaskDetailPane`'s own
`--tasks-detail-bg` pattern). Once Task 3 (virtual "Starred" list) shipped,
this covered that view too for free, since both reuse the same `TasksPane`
component.

A mobile-only stacking bug surfaced during verification: the sticky
header's `z-index` originally tied with `TaskItem`'s own mobile-only
`.row { z-index: 1 }` (its swipe-to-reveal need), and — since no ancestor
between a task row and the pane established its own stacking context — the
tie resolved by DOM order, letting scrolled task rows paint over the
"pinned" header instead of stopping underneath it. Fixed by giving the
sticky header `z-index: 2`.

## Today's Agenda (TSK-30)

Shipped ahead of v1.0. A swipeable, mobile-first triage view at
`/tasks/today` over every top-level, incomplete task due today, overdue, or
starred — built on `@sovereignfs/ui`'s `SwipeStack` compound component. One
card at a time: left snoozes to tomorrow, right keeps it for today (bumping
an overdue task's due date to today), up marks it done (a recurring task
still spawns its next occurrence), down cancels it (deletes outright, with
no confirmation — `SwipeStack`'s exit animation has already committed by
the time the app hears about it). Reached from the mobile footer's right
icon, which this feature took over from Search (an accepted tradeoff —
`/tasks/search` still works, just isn't linked from the footer anymore),
and from the due-reminders morning digest notification, which now deep-links
here instead of bare `/tasks`. See `CLAUDE.md`'s "Today's Agenda" section
for the full design.

## v1.0 — Polish and reference implementation

Accessibility audit, full keyboard navigation, documentation, and publication to the Sovereign plugin registry as the canonical reference implementation.
