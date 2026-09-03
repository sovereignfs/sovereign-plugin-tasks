import { EmptyState } from '@sovereignfs/ui';
import Link from 'next/link';
import { searchTasks } from '../_lib/actions';
import MobileSearchBox from './MobileSearchBox';
import styles from './search.module.css';

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function SearchPage({ searchParams }: Props) {
  const { q } = await searchParams;
  const query = (q ?? '').trim();
  const results = query ? await searchTasks(query) : [];

  if (!query) {
    return (
      <>
        <MobileSearchBox />
        <EmptyState
          icon="search"
          heading="Search tasks"
          description="Find tasks by title across all your lists."
        />
      </>
    );
  }

  if (results.length === 0) {
    return (
      <>
        <MobileSearchBox />
        <EmptyState icon="search" heading="No matches" description={`Nothing matches “${query}”.`} />
      </>
    );
  }

  return (
    <>
      <MobileSearchBox />
      <div className={styles.wrap}>
        <h1 className={styles.heading}>
          Results for “{query}” <span className={styles.count}>· {results.length}</span>
        </h1>
        <ul className={styles.list}>
          {results.map((r) => (
            <li key={r.id} className={styles.item}>
              <Link href={`/tasks/${r.listId}?task=${r.id}`} className={styles.link}>
                <span
                  className={[styles.title, r.completedAt !== null ? styles.done : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {r.title}
                </span>
                <span className={styles.listName}>{r.listTitle}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}
