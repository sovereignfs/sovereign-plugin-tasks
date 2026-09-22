import { describe, expect, it } from 'vitest';
import { buildAgenda, classifyAgendaTask } from '../agenda';
import type { StarredTaskRow } from '../types';

const TODAY = '2026-07-11';

function task(overrides: Partial<StarredTaskRow> = {}): StarredTaskRow {
  return {
    id: 'task-1',
    listId: 'list-1',
    title: 'Untitled',
    notes: null,
    completedAt: null,
    parentId: null,
    favorite: false,
    dueDate: null,
    dueTime: null,
    recurrenceRule: null,
    subtaskCount: 0,
    subtaskDoneCount: 0,
    createdAt: 0,
    listTitle: 'Inbox',
    listColor: null,
    ...overrides,
  };
}

describe('classifyAgendaTask', () => {
  it('classifies a past due date as overdue', () => {
    expect(classifyAgendaTask(task({ dueDate: '2026-07-10' }), TODAY)).toBe('overdue');
  });

  it('classifies today\'s due date as dueToday', () => {
    expect(classifyAgendaTask(task({ dueDate: TODAY }), TODAY)).toBe('dueToday');
  });

  it('classifies a future due date with no star as not on the agenda', () => {
    expect(classifyAgendaTask(task({ dueDate: '2026-07-12' }), TODAY)).toBeNull();
  });

  it('classifies a starred task with no qualifying due date as starred', () => {
    expect(classifyAgendaTask(task({ favorite: true }), TODAY)).toBe('starred');
    expect(classifyAgendaTask(task({ favorite: true, dueDate: '2026-07-20' }), TODAY)).toBe(
      'starred',
    );
  });

  it('prefers overdue/dueToday over starred when both apply', () => {
    expect(classifyAgendaTask(task({ favorite: true, dueDate: '2026-07-10' }), TODAY)).toBe(
      'overdue',
    );
    expect(classifyAgendaTask(task({ favorite: true, dueDate: TODAY }), TODAY)).toBe('dueToday');
  });

  it('excludes a completed task regardless of due date or star', () => {
    expect(
      classifyAgendaTask(task({ completedAt: 100, dueDate: '2026-07-01', favorite: true }), TODAY),
    ).toBeNull();
  });

  it('excludes a task with neither a qualifying due date nor a star', () => {
    expect(classifyAgendaTask(task(), TODAY)).toBeNull();
  });
});

describe('buildAgenda', () => {
  it('drops non-qualifying tasks and orders overdue > dueToday > starred', () => {
    const tasks = [
      task({ id: 'starred', favorite: true, title: 'Z starred' }),
      task({ id: 'future', dueDate: '2026-07-30' }),
      task({ id: 'due-today', dueDate: TODAY, dueTime: '09:00' }),
      task({ id: 'overdue', dueDate: '2026-07-05' }),
    ];
    const entries = buildAgenda(tasks, TODAY);
    expect(entries.map((e) => e.task.id)).toEqual(['overdue', 'due-today', 'starred']);
    expect(entries.map((e) => e.reason)).toEqual(['overdue', 'dueToday', 'starred']);
  });

  it('orders multiple overdue tasks by oldest due date first', () => {
    const tasks = [
      task({ id: 'a', dueDate: '2026-07-08' }),
      task({ id: 'b', dueDate: '2026-07-02' }),
      task({ id: 'c', dueDate: '2026-07-05' }),
    ];
    expect(buildAgenda(tasks, TODAY).map((e) => e.task.id)).toEqual(['b', 'c', 'a']);
  });

  it('orders due-today tasks by due time, with no-time last', () => {
    const tasks = [
      task({ id: 'no-time', dueDate: TODAY, dueTime: null }),
      task({ id: 'afternoon', dueDate: TODAY, dueTime: '15:00' }),
      task({ id: 'morning', dueDate: TODAY, dueTime: '08:00' }),
    ];
    expect(buildAgenda(tasks, TODAY).map((e) => e.task.id)).toEqual([
      'morning',
      'afternoon',
      'no-time',
    ]);
  });

  it('orders starred-only tasks alphabetically by title', () => {
    const tasks = [
      task({ id: 'b', favorite: true, title: 'Buy groceries' }),
      task({ id: 'a', favorite: true, title: 'Assemble desk' }),
    ];
    expect(buildAgenda(tasks, TODAY).map((e) => e.task.id)).toEqual(['a', 'b']);
  });

  it('returns an empty stack when nothing qualifies', () => {
    expect(buildAgenda([task(), task({ dueDate: '2026-08-01' })], TODAY)).toEqual([]);
  });
});
