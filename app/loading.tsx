import { Spinner } from '@sovereignfs/ui';
import styles from './loading.module.css';

/**
 * `[listId]`, `search`, and `starred` all await the database before they can
 * render — without this the shell mounts first and the content column stays
 * blank until the fetch resolves.
 */
export default function TasksLoading() {
  return (
    <div className={styles.root} role="status" aria-live="polite">
      <Spinner />
      <span>Loading…</span>
    </div>
  );
}
