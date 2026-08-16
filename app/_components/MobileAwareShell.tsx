'use client';

import type { ReactNode } from 'react';
import { useIsMobile } from '../_lib/useIsMobile';
import type { ListRow } from '../_lib/types';
import DesktopTasksShell from './DesktopTasksShell';
import MobileTasksCarousel from './MobileTasksCarousel';
import styles from '../layout.module.css';

/** A sibling plugin the mobile footer's self-rendered Apps drawer can link
 *  to — a leaner projection of `@sovereignfs/sdk`'s `PluginAvailability`,
 *  resolved server-side in `layout.tsx` (`sdk.plugins.list()` needs
 *  `next/headers` and can't be called from this client component). */
export interface FooterAppEntry {
  id: string;
  name: string;
  routePrefix: string;
  iconUrl?: string;
}

interface Props {
  lists: ListRow[];
  /** Count of active starred tasks — see ListSidebar's own doc comment. */
  starredCount: number;
  /** Every other launchable plugin, for the mobile footer's self-rendered
   *  Apps drawer — see MobileTasksCarousel's own doc comment for why this
   *  plugin renders its own footer (`shellConfig.mobileFooter: false`)
   *  instead of the platform's. Unused on desktop. */
  footerApps: FooterAppEntry[];
  /** The Launcher plugin's own icon URL, for the footer's center Apps
   *  button — matches the platform shell's own MobileNav treatment (the
   *  Launcher gets a dedicated slot with its real icon, not the generic
   *  fallback, and is excluded from the drawer grid itself). `undefined`
   *  falls back to MobileFooter's own default grid icon. */
  launcherIconUrl?: string;
  children: ReactNode;
}

/**
 * Forks the plugin's root shell between the desktop/tablet three-column
 * layout (unchanged) and the mobile swipeable-lists carousel. This has to be
 * a client component — nothing else in the runtime picks a component tree
 * based on viewport in JS, since CSS media queries can't express "mount an
 * entirely different set of components."
 *
 * On mobile, `children` (page.tsx's server-rendered output for the current
 * route) is deliberately not rendered — MobileTasksCarousel manages its own
 * client-side data for every list so swiping between them is instant. It is
 * still passed through as `refreshSignal`: React re-invokes this component
 * with a new `children` reference on every server refresh (e.g. any
 * router.refresh() call inside TasksPane/TaskDetailPane/etc.), which the
 * carousel uses purely as a signal to re-fetch its active slide — see
 * MobileTasksCarousel's own doc comment.
 */
export default function MobileAwareShell({
  lists,
  starredCount,
  footerApps,
  launcherIconUrl,
  children,
}: Props) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className={styles.shell} data-plugin-fullbleed>
        <MobileTasksCarousel
          lists={lists}
          starredCount={starredCount}
          footerApps={footerApps}
          launcherIconUrl={launcherIconUrl}
          refreshSignal={children}
        />
      </div>
    );
  }

  return (
    <DesktopTasksShell lists={lists} starredCount={starredCount} refreshSignal={children}>
      {children}
    </DesktopTasksShell>
  );
}
