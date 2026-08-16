'use client';

import { offline } from '@sovereignfs/sdk/offline';
import type { TaskRow } from './types';

/**
 * Persistence + staleness helpers backing MobileTasksCarousel's client-side
 * list/task cache — findings doc Issue 2 and Part 2's settled design
 * questions (`docs/data-fetching-and-mobile-interaction-findings.md`).
 * Deliberately plugin-local for now (scope decision 1: this is the only
 * real consumer today), but written so the shape — get/set a small
 * JSON-serializable entry per key, with a staleness timestamp — could be
 * lifted into a shared `@sovereignfs/ui`/SDK primitive later with no
 * redesign, just generalization.
 */

const PLUGIN_ID = 'fs.sovereign.tasks';

/**
 * How long a cached list is considered fresh before becoming active again
 * (a swipe back to it, or the tab/window regaining focus while it's already
 * active) triggers a background revalidate (decision 2: revalidate-on-focus).
 * Short enough that a same-session edit from another tab shows up quickly;
 * long enough that rapid carousel swiping back and forth doesn't refetch on
 * every pass.
 */
export const STALE_AFTER_MS = 60_000;

export interface CachedList {
  tasks: TaskRow[];
  showCompleted: boolean;
  /** `Date.now()` when this entry was last fetched from the server —
   *  drives the staleness check above. */
  fetchedAt: number;
}

function offlineKey(listId: string): string {
  return `list:${listId}`;
}

/**
 * Best-effort persisted read (decision 3: IndexedDB via the SDK's existing
 * `offline` module — see this file's own module comment below for why that
 * module specifically, rather than a hand-rolled store). Used only to seed
 * the very first paint of a list not yet loaded in-memory this session
 * (e.g. right after a cold reload); never a substitute for the real
 * network fetch that always follows it. Returns `null` on any failure
 * (unsupported browser, corrupt/never-written entry, quota) — a cache miss
 * is always a safe fallback to the existing loading-skeleton behavior.
 */
export async function readPersistedList(listId: string): Promise<CachedList | null> {
  try {
    return await offline.get<CachedList>(PLUGIN_ID, offlineKey(listId));
  } catch {
    return null;
  }
}

/**
 * Best-effort persisted write, fired after every successful server fetch.
 * Never awaited by callers — the in-memory `listState` is already
 * authoritative for the current session; this only improves the *next*
 * cold start. Swallows its own errors (full quota, unsupported browser)
 * for the same reason: a persistence failure should never surface as a
 * user-visible error for what is otherwise a fully successful fetch.
 */
export function persistList(listId: string, entry: CachedList): void {
  void offline.set(PLUGIN_ID, offlineKey(listId), entry).catch(() => {
    // Best-effort — see doc comment above.
  });
}

/**
 * Why `@sovereignfs/sdk/offline` and not a plugin-local IndexedDB wrapper:
 * this plugin isn't declaring itself an "offline-capable plugin" (RFC 0074's
 * `offline` manifest tier) — this cache exists purely to avoid redundant
 * fetches and speed up cold start, not to make Tasks usable with no network
 * connection at all. But that SDK module's actual purge guarantee is exactly
 * what a cache like this needs and cannot safely go without:
 * `runtime/src/complete-sign-in.ts` calls `offline.clearAll()` on every
 * successful new sign-in (not just an explicit sign-out — also covers a
 * session that ends by expiring or the tab being closed, which a
 * plugin-local "clear on sign-out button click" hook would miss entirely).
 * Building a separate store here would mean either losing that guarantee or
 * re-deriving it — a real, previously-shipped platform incident (the
 * `0.76.1` hotfix, see the platform repo's own `CLAUDE.md`) is exactly a
 * cache that lacked this and leaked a previous user's content to the next
 * person on a shared device. Reusing the module that already has this
 * covered was judged safer than reusing its *name*'s implied scope was worth
 * avoiding. No manifest change needed — this module has no gate requiring
 * the `offline` tier to be declared; that field only controls the platform's
 * *separate* service-worker precache-the-shell behavior, which this doesn't
 * use or need.
 */
