'use client';

import { Button, Dialog, Icon, Toggle, useToast } from '@sovereignfs/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import { exportTasksAsJson, importTasksFromJson } from '../_lib/dataFile';
import { getNotificationPrefs, saveNotificationPrefs } from '../_lib/actions';
import { todayISO } from '../_lib/date';
import styles from './TasksSettings.module.css';

/**
 * Combined Tasks settings (TSK-31) — due/overdue notification preferences
 * (TSK-15/v0.11) plus plugin-local single-JSON-file export/import,
 * standing in for what used to be a notifications-only bell button in the
 * list sidebar's header. Opens a single Dialog (a full-screen sheet on
 * mobile by the DS's own adaptive behaviour) with a Notifications section
 * and a Data section.
 *
 * The browser's IANA timezone is captured on every notifications save —
 * never shown or asked for. "Morning" means the user's wall clock wherever
 * they are when they last touched these settings.
 *
 * Export/import here is deliberately a standalone, single-file counterpart
 * to the account-level Export/Import my data flow (TSK-29) — same file
 * shape (a plugin.export section), reused validation/row logic
 * (app/_lib/portability.ts), just reached from inside this plugin instead
 * of Account → Data. Import is additive, same contract as the account-level
 * flow: it never replaces or removes existing lists/tasks, so importing the
 * same file twice duplicates everything rather than erroring.
 */
export default function TasksSettings() {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [morningTime, setMorningTime] = useState('08:00');
  const [saved, setSaved] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoaded(false);
    void getNotificationPrefs().then((prefs) => {
      if (cancelled) return;
      setEnabled(prefs.enabled);
      setMorningTime(prefs.morningTime);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function handleSave() {
    startTransition(async () => {
      await saveNotificationPrefs({
        enabled,
        morningTime,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setOpen(false);
      }, 800);
    });
  }

  async function handleExport() {
    setExporting(true);
    try {
      const section = await exportTasksAsJson();
      const blob = new Blob([JSON.stringify(section, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `sovereign-tasks-export-${todayISO()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.show({
        title: 'Export failed',
        message: 'Something went wrong preparing the file — try again.',
        category: 'error',
      });
    } finally {
      setExporting(false);
    }
  }

  function handleImportClick() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the exact same file again still fires this handler.
    e.target.value = '';
    if (!file) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      toast.show({
        title: 'Import failed',
        message: 'That file is not valid JSON.',
        category: 'error',
      });
      return;
    }

    setImporting(true);
    try {
      const result = await importTasksFromJson(parsed);
      if (!result.ok || !result.summary) {
        toast.show({
          title: 'Import failed',
          message: result.error ?? 'Something went wrong importing that file.',
          category: 'error',
        });
        return;
      }
      const { lists, items } = result.summary;
      toast.show({
        title: 'Import complete',
        message: `Added ${lists} ${lists === 1 ? 'list' : 'lists'} and ${items} ${items === 1 ? 'task' : 'tasks'}.`,
        category: 'success',
      });
      router.refresh();
      setOpen(false);
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.settingsBtn}
        aria-label="Settings"
        onClick={() => setOpen(true)}
      >
        <Icon name="settings" size="sm" aria-hidden />
      </button>

      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="Settings">
        <div className={styles.body}>
          <div className={styles.row}>
            <div className={styles.rowText}>
              <span className={styles.rowLabel}>Due & overdue notifications</span>
              <span className={styles.rowHint}>
                A morning summary of tasks due today and overdue, plus a reminder when a task's
                due time arrives.
              </span>
            </div>
            <Toggle
              checked={enabled}
              onChange={setEnabled}
              disabled={!loaded}
              aria-label="Enable due and overdue notifications"
            />
          </div>

          <div className={styles.row}>
            <label className={styles.rowLabel} htmlFor="tasks-morning-time">
              Morning summary at
            </label>
            <input
              id="tasks-morning-time"
              className={styles.timeInput}
              type="time"
              value={morningTime}
              disabled={!loaded || !enabled}
              onChange={(e) => setMorningTime(e.target.value)}
            />
          </div>

          <p className={styles.pushHint}>
            To get notified while the app is closed, also enable push notifications for this
            device under Account → Notifications.
          </p>

          <div className={styles.footer}>
            <Button variant="primary" disabled={!loaded} onClick={handleSave}>
              {saved ? 'Saved' : 'Save'}
            </Button>
          </div>

          <div className={styles.section}>
            <span className={styles.sectionHeading}>Data</span>

            <div className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowLabel}>Export</span>
                <span className={styles.rowHint}>
                  Download every list and task as one JSON file.
                </span>
              </div>
              <Button variant="secondary" disabled={exporting} onClick={handleExport}>
                {exporting ? 'Exporting…' : 'Export'}
              </Button>
            </div>

            <div className={styles.row}>
              <div className={styles.rowText}>
                <span className={styles.rowLabel}>Import</span>
                <span className={styles.rowHint}>
                  Adds the lists and tasks from a file exported this way — it never replaces or
                  removes anything already here.
                </span>
              </div>
              <Button variant="secondary" disabled={importing} onClick={handleImportClick}>
                {importing ? 'Importing…' : 'Import'}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className={styles.hiddenFileInput}
                onChange={(e) => void handleFileSelected(e)}
              />
            </div>
          </div>
        </div>
      </Dialog>
    </>
  );
}
