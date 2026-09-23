'use server';

import type { PluginExportSection } from '@sovereignfs/sdk';
import { getContext } from './actions';
import { createRemapId, validateExportFile } from './exportFile';
import { exportTasksData, importTasksData } from './portability';

/**
 * Plugin-local single-JSON-file export/import (TSK-31) — a standalone
 * counterpart to the account-level ZIP flow (TSK-29, portability.ts),
 * reached from Settings inside this plugin instead of Account → Export/
 * Import my data. Deliberately thin: exportTasksData/importTasksData
 * already do the real work and are otherwise only ever invoked by the
 * platform's portability registry — these wrappers just build the same
 * {userId, tenantId, ...} context shape by hand instead of receiving it
 * from that registry, so the underlying row-level logic (and its existing
 * portability.test.ts coverage) is reused unmodified. File-shape validation
 * lives in exportFile.ts (a plain module, not 'use server' — every export
 * from this file must be async, which a synchronous validator can't be).
 */

export async function exportTasksAsJson(): Promise<PluginExportSection> {
  const { userId, tenantId } = await getContext();
  return exportTasksData({ userId, tenantId, options: { includeFiles: true } });
}

export interface TasksImportOutcome {
  ok: boolean;
  error?: string;
  /** Present only when ok is true. */
  summary?: { lists: number; items: number };
}

/** Additive, same as the account-level import — never wipes existing data,
 *  never overwrites the singleton notification-prefs row if one already
 *  exists (see importTasksData's own doc comment). A second import of the
 *  same file duplicates lists/tasks rather than erroring. */
export async function importTasksFromJson(raw: unknown): Promise<TasksImportOutcome> {
  const { userId, tenantId } = await getContext();

  const validated = validateExportFile(raw);
  if ('error' in validated) return { ok: false, error: validated.error };

  await importTasksData(validated, { userId, tenantId, remapId: createRemapId() });
  const data = validated.data as { lists: unknown[]; items: unknown[] };
  return { ok: true, summary: { lists: data.lists.length, items: data.items.length } };
}
