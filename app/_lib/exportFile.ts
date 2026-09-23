/**
 * Pure helpers for the plugin-local single-JSON-file export/import (TSK-31).
 * Kept IO-free (no 'use server', no DB) so the file-shape validation is
 * unit-testable without a database — same split as agenda.ts/notify.ts from
 * their own 'use server' callers (actions.ts/due-reminders.ts). Used by
 * app/_lib/dataFile.ts, which is a 'use server' file and therefore cannot
 * itself export a synchronous function like this one.
 */

import type { PluginExportSection } from '@sovereignfs/sdk';
import { randomUUID } from 'node:crypto';
import { EXPORT_SCHEMA_VERSION, PLUGIN_ID, isTasksExportData } from './portability';

/** The file's top-level shape is the exact same PluginExportSection envelope
 *  the account-level ZIP stores at plugins/fs.sovereign.tasks/data.json —
 *  the two are deliberately interchangeable, so a file taken out of an
 *  account export can be dropped in here too, and vice versa. */
export function validateExportFile(raw: unknown): PluginExportSection | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'Not a Sovereign Tasks export file.' };
  const candidate = raw as Partial<PluginExportSection>;
  if (candidate.pluginId !== PLUGIN_ID) {
    return { error: 'This file was exported from a different app, not Tasks.' };
  }
  if (candidate.schemaVersion !== EXPORT_SCHEMA_VERSION) {
    return { error: 'This export was made by an incompatible version of Tasks.' };
  }
  if (!isTasksExportData(candidate.data)) {
    return { error: 'This file is not a valid Sovereign Tasks export.' };
  }
  return raw as PluginExportSection;
}

/** Per-import id remapper (ImportContext.remapId) — the platform's real one
 *  guarantees the same stability (same original id -> same new id, every
 *  call within one import), so a plain local Map + randomUUID reproduces it
 *  exactly for this standalone path with no other machinery needed. */
export function createRemapId(): (originalId: string) => string {
  const minted = new Map<string, string>();
  return (originalId: string) => {
    let id = minted.get(originalId);
    if (!id) {
      id = randomUUID();
      minted.set(originalId, id);
    }
    return id;
  };
}
