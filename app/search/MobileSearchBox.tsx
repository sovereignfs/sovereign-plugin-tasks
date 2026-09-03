'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useIsMobile } from '../_lib/useIsMobile';
import listSidebarStyles from '../ListSidebar.module.css';
import styles from './search.module.css';

/**
 * Mobile-only search input for /tasks/search. The only real search box in
 * this plugin lives in ListSidebar's "Lists" slide — but on mobile,
 * MobileTasksCarousel renders /tasks/search's real server output (this
 * page) *in place of* the whole carousel (see MobileTasksCarousel.tsx's
 * `isCarouselRoute`), which means ListSidebar — and its search box — isn't
 * mounted at all while viewing search. Landing here via the footer's Search
 * icon (which navigates straight to /tasks/search with no `?q=`) previously
 * had no input anywhere on screen: the empty-state heading/description are
 * static text, not a control. Submitting a query from the Lists slide had
 * the same gap in reverse — once on the results page, there was no way to
 * edit or clear the query without swiping back.
 *
 * Reuses ListSidebar's own search box styles (not duplicated) so this reads
 * as the same control, not a second, slightly-different one. Desktop
 * doesn't need this: ListSidebar's sidebar (and its search box) is always
 * on screen there, in column 1, regardless of route.
 */
export default function MobileSearchBox() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');

  if (!isMobile) return null;

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/tasks/search?q=${encodeURIComponent(q)}` : '/tasks/search');
  }

  return (
    <div className={styles.mobileSearchWrap}>
      <form className={listSidebarStyles.searchRow} onSubmit={handleSubmit} role="search">
        <span className={listSidebarStyles.searchIcon} aria-hidden>
          ⌕
        </span>
        <input
          className={listSidebarStyles.searchInput}
          type="search"
          placeholder="Search tasks…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tasks"
        />
      </form>
    </div>
  );
}
