import type { ReactNode } from 'react';
import { sdk } from '@sovereignfs/sdk';
import MobileAwareShell from './_components/MobileAwareShell';
import { countStarredTasks, getLists } from './_lib/actions';
import { registerPortabilityHandlers } from './_lib/portability';
import type { FooterAppEntry } from './_components/MobileAwareShell';

const PLUGIN_ID = 'fs.sovereign.tasks';
// Mirrors runtime/app/(platform)/layout.tsx's own DEFAULT_ROOT_PLUGIN_ID
// literal — used below to give the footer's center button the Launcher's
// own icon, matching the platform shell's MobileNav exactly.
//
// Deliberately NOT also excluded from the drawer grid the way the platform
// shell excludes it from its own: that exclusion only works there because
// the platform footer's separate *left* icon is a dedicated "Home" button —
// this plugin's left icon is repurposed for "Lists" (see
// MobileTasksCarousel's own doc comment), so the Apps drawer is this
// footer's only remaining way back to the Launcher. Excluding it here would
// silently strand users with no path home at all.
const LAUNCHER_PLUGIN_ID = 'fs.sovereign.launcher';

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
  // instead of the platform's. Excludes this plugin itself and anything not
  // currently launchable for this user (disabled, adminOnly-gated, or
  // paywalled — `availableToUser` already folds all three in). Launcher
  // stays included — see LAUNCHER_PLUGIN_ID's own comment above for why.
  // `icon` here is the manifest's raw declared icon filename, not a
  // resolved URL — same convention the platform shell itself uses to build
  // `/plugin-icons/<id>.svg`.
  const footerApps: FooterAppEntry[] = installedPlugins
    .filter((p) => p.id !== PLUGIN_ID && p.availableToUser)
    .map((p) => ({
      id: p.id,
      name: p.name,
      routePrefix: p.routePrefix,
      iconUrl: p.icon ? `/plugin-icons/${p.id}.svg` : undefined,
    }));

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
