import type { ReactNode } from 'react';
import { sdk } from '@sovereignfs/sdk';
import MobileAwareShell from './_components/MobileAwareShell';
import { countStarredTasks, getLists } from './_lib/actions';
import { registerPortabilityHandlers } from './_lib/portability';
import type { FooterAppEntry } from './_components/MobileAwareShell';

const PLUGIN_ID = 'fs.sovereign.tasks';
// Mirrors runtime/app/(platform)/layout.tsx's own DEFAULT_ROOT_PLUGIN_ID
// literal — used below to give the footer's center button the Launcher's
// own icon, matching the platform shell's MobileNav exactly, and to pin the
// drawer's own Launcher tile first (relabeled "Home" — see footerApps below).
//
// Kept in the drawer grid, unlike the platform's own drawer which excludes
// the Launcher entirely: that exclusion only works there because the
// platform footer's separate *left* icon is a dedicated "Home" button — this
// plugin's left icon is repurposed for "Lists" (see MobileTasksCarousel's
// own doc comment), so the drawer is this footer's only remaining way back
// to the Launcher. Excluding it here would silently strand users with no
// path home at all.
const LAUNCHER_PLUGIN_ID = 'fs.sovereign.launcher';
// Always pinned last in the drawer grid — see footerApps below.
const CONSOLE_PLUGIN_ID = 'fs.sovereign.console';
// Never shown in this drawer at all — Account is reached via the platform
// shell's own account menu, not a per-plugin footer, and showing it here
// would just duplicate that entry point inconsistently (Account has no
// dedicated affordance on desktop's version of this plugin either).
const ACCOUNT_PLUGIN_ID = 'fs.sovereign.account';

/** Sort key for the Apps drawer grid — Home first, Console last, everything
 *  else in between at an equal rank (Array.prototype.sort is stable, so
 *  ties preserve installedPlugins' own relative order). */
function footerAppRank(pluginId: string): number {
  if (pluginId === LAUNCHER_PLUGIN_ID) return 0;
  if (pluginId === CONSOLE_PLUGIN_ID) return 2;
  return 1;
}

export default async function TasksLayout({ children }: { children: ReactNode }) {
  // In-process and reset on restart — the platform SDK requires
  // re-registering from a request-scoped plugin route, so this runs on
  // every request. Best-effort: a registration failure must not block the
  // plugin's own UI (matches sovereign-plainwrite's layout.tsx).
  try {
    await registerPortabilityHandlers();
  } catch {
    // Portability is a best-effort platform integration.
  }

  const [lists, starredCount, installedPlugins] = await Promise.all([
    getLists(),
    countStarredTasks(),
    sdk.plugins.list(),
  ]);

  // The mobile shell's self-rendered Apps drawer (MobileAwareShell) — see
  // that file's own doc comment for why this plugin renders its own footer
  // instead of the platform's. Excludes this plugin itself, Account (see
  // ACCOUNT_PLUGIN_ID's own comment above), and anything not currently
  // launchable for this user (disabled, adminOnly-gated, or paywalled —
  // `availableToUser` already folds all three in). Launcher is relabeled
  // "Home" and pinned first, Console is pinned last, everything else keeps
  // its natural sdk.plugins.list() order in between — `.sort` is stable, so
  // the two pins only reorder the entries they target. `icon` here is the
  // manifest's raw declared icon filename, not a resolved URL — same
  // convention the platform shell itself uses to build
  // `/plugin-icons/<id>.svg`.
  const footerApps: FooterAppEntry[] = installedPlugins
    .filter((p) => p.id !== PLUGIN_ID && p.id !== ACCOUNT_PLUGIN_ID && p.availableToUser)
    .map((p) => ({
      id: p.id,
      name: p.id === LAUNCHER_PLUGIN_ID ? 'Home' : p.name,
      routePrefix: p.routePrefix,
      iconUrl: p.icon ? `/plugin-icons/${p.id}.svg` : undefined,
    }))
    .sort((a, b) => footerAppRank(a.id) - footerAppRank(b.id));

  const launcher = installedPlugins.find((p) => p.id === LAUNCHER_PLUGIN_ID);
  const launcherIconUrl = launcher?.icon ? `/plugin-icons/${launcher.id}.svg` : undefined;

  return (
    <MobileAwareShell
      lists={lists}
      starredCount={starredCount}
      footerApps={footerApps}
      launcherIconUrl={launcherIconUrl}
    >
      {children}
    </MobileAwareShell>
  );
}
