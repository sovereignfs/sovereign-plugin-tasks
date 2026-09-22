import { getAgendaTasks } from '../_lib/actions';
import TodayAgendaView from './TodayAgendaView';

/**
 * Today's Agenda (TSK-30) — a static segment, same trick as `starred/` and
 * `search/`: it beats `[listId]`'s dynamic match, so nothing there needs to
 * special-case it. Reached from the mobile footer's right icon and from the
 * due-reminders morning digest notification; both `MobileTasksCarousel`'s
 * `isCarouselRoute` and `DesktopTasksShell`'s `activeListIdForPathname`
 * already fall through to rendering this page's own output for any
 * unrecognized top-level route (built for `/tasks/search`), so this page
 * works on both shells with no routing changes anywhere else.
 */
export default async function TodayPage() {
  const tasks = await getAgendaTasks();
  return <TodayAgendaView tasks={tasks} />;
}
