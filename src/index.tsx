import { addIcon } from '@iconify/react';
import { Icon } from '@iconify/react';
import {
  registerAppBarAction,
  registerKubeObjectGlance,
  registerRoute,
  registerSidebarEntry,
  registerSidebarEntryFilter,
} from '@kinvolk/headlamp-plugin/lib';
import { Box } from '@mui/material';
import { useEffect } from 'react';

// Monochrome logo — used for the sidebar entry (adapts to theme via currentColor)
addIcon('crossplane:mono', {
  body: '<g fill="currentColor"><path d="M263.8,389.5v45.3v31.4c0,10.7-7,19.4-15.5,19.4c-8.6,0-15.5-8.7-15.5-19.4v-76.7H263.8 M278,375.3h-59.4v90.9c0,18.6,13.3,33.6,29.7,33.6s29.7-15,29.7-33.6v-31.4V375.3L278,375.3z"/><path d="M338.4,61.9c9.9,15.4,15.6,33.1,16.4,51.7c0.1,1.6,0.1,3.3,0.1,4.9c0,1.6,0,3.3-0.1,5l0,0.7l0,0.7c0,0.4,0.1,0.8,0.1,1.2c0,0.5,0.1,1.1,0.1,1.4v55.7L170.1,368c-15.8-9.9-25.5-27.1-25.5-46v-66.3L338.4,61.9 M339.8,41.5L131.2,250.2V322c0,27.9,17.2,52,41.5,62.3l195.6-195.6v-61.2c0-1.1-0.1-2.2-0.2-3.3c0.1-1.9,0.1-3.8,0.1-5.7c0-1.9,0-3.7-0.1-5.5C366.9,85.8,356.4,60.9,339.8,41.5L339.8,41.5z"/><path d="M249.7,0c-63.6,0-115.5,50.1-118.4,113c-0.1,1.8-0.1,3.7-0.1,5.5c0,2,0,4,0.2,6c0,1-0.2,2-0.2,3v122.6L339.8,41.5C318.1,16.1,285.8,0,249.7,0z"/><path d="M198.9,389.7h101.8c37.2,0,67.6-30.4,67.6-67.6V188.3L172.4,384.2C180.5,387.7,189.5,389.7,198.9,389.7z"/></g>',
  width: 500,
  height: 500,
});

// Full-color logo — used for the Map source selector (icon.svg)
addIcon('crossplane:color', {
  body: '<style>.xp-s0{clip-path:url(#xp-c2);fill:#F7D186}.xp-s1{clip-path:url(#xp-c4);enable-background:new}.xp-s2{clip-path:url(#xp-c6)}.xp-s3{clip-path:url(#xp-c8)}.xp-s4{clip-path:url(#xp-c10);fill:#FFCD3C}.xp-s5{clip-path:url(#xp-c12);enable-background:new}.xp-s6{clip-path:url(#xp-c14)}.xp-s7{clip-path:url(#xp-c16)}.xp-s8{clip-path:url(#xp-c18);fill:#F3807B}.xp-s9{clip-path:url(#xp-c20);enable-background:new}.xp-s10{clip-path:url(#xp-c22)}.xp-s11{clip-path:url(#xp-c24)}.xp-s12{clip-path:url(#xp-c26);fill:#35D0BA}.xp-s13{clip-path:url(#xp-c28);fill:#D8AE64}</style><defs><path id="xp-p1" d="M447.73,309.78c-25.83,0-46.76,20.94-46.76,46.76v440.04c0,25.83,20.94,46.76,46.76,46.76s46.76-20.93,46.76-46.76V356.55C494.5,330.72,473.56,309.78,447.73,309.78"/><path id="xp-p3" d="M263.62,234.54c-0.13,2.87-0.2,5.76-0.2,8.68c0,3.19,0.07,6.35,0.24,9.5c-0.07,1.55-0.24,3.08-0.24,4.66v306.18c0,58.55,47.91,106.46,106.46,106.46h160.22c58.56,0,106.46-47.91,106.46-106.46V257.37c0-1.78-0.18-3.51-0.28-5.26c0.14-2.95,0.22-5.92,0.22-8.89c0-2.92-0.07-5.8-0.2-8.68C631.8,135.53,550.1,56.66,449.98,56.66C349.85,56.66,268.14,135.53,263.62,234.54z"/></defs><clipPath id="xp-c2"><use href="#xp-p1" style="overflow:visible"/></clipPath><rect x="368.03" y="276.84" class="xp-s0" width="159.41" height="599.44"/><clipPath id="xp-c4"><use href="#xp-p3" style="overflow:visible"/></clipPath><g class="xp-s1"><defs><rect id="xp-r5" x="142.32" y="97.05" width="606.11" height="606.11"/></defs><clipPath id="xp-c6"><use href="#xp-r5" style="overflow:visible"/></clipPath><g class="xp-s2"><defs><rect id="xp-r7" x="121.45" y="305.69" transform="matrix(0.7071 -0.7071 0.7071 0.7071 -153.8743 435.4041)" width="654.38" height="195.52"/></defs><clipPath id="xp-c8"><use href="#xp-r7" style="overflow:visible"/></clipPath><g class="xp-s3"><defs><rect id="xp-r9" x="260.91" y="50.93" width="382.11" height="619.29"/></defs><clipPath id="xp-c10"><use href="#xp-r9" style="overflow:visible"/></clipPath><rect x="115.65" y="70.37" class="xp-s4" width="665.66" height="665.66"/></g></g></g><clipPath id="xp-c12"><use href="#xp-p3" style="overflow:visible"/></clipPath><g class="xp-s5"><defs><rect id="xp-r13" x="-22.38" y="-67.66" width="639.05" height="639.05"/></defs><clipPath id="xp-c14"><use href="#xp-r13" style="overflow:visible"/></clipPath><g class="xp-s6"><defs><rect id="xp-r15" x="-32.95" y="128.38" transform="matrix(0.7071 -0.7071 0.7071 0.7071 -89.8659 280.9871)" width="654.39" height="241.18"/></defs><clipPath id="xp-c16"><use href="#xp-r15" style="overflow:visible"/></clipPath><g class="xp-s7"><defs><rect id="xp-r17" x="260.91" y="50.93" width="382.11" height="619.29"/></defs><clipPath id="xp-c18"><use href="#xp-r17" style="overflow:visible"/></clipPath><rect x="-55.33" y="-100.6" class="xp-s8" width="699.14" height="699.14"/></g></g></g><clipPath id="xp-c20"><use href="#xp-p3" style="overflow:visible"/></clipPath><g class="xp-s9"><defs><rect id="xp-r21" x="280.67" y="235.4" width="606.11" height="606.11"/></defs><clipPath id="xp-c22"><use href="#xp-r21" style="overflow:visible"/></clipPath><g class="xp-s10"><defs><polygon id="xp-p23" points="885.86,377.86 423.14,840.59 286.09,703.54 748.81,240.81"/></defs><clipPath id="xp-c24"><use href="#xp-p23" style="overflow:visible"/></clipPath><g class="xp-s11"><defs><rect id="xp-r25" x="260.91" y="50.93" width="382.11" height="619.29"/></defs><clipPath id="xp-c26"><use href="#xp-r25" style="overflow:visible"/></clipPath><rect x="253.14" y="207.87" class="xp-s12" width="665.66" height="665.66"/></g></g></g><defs><polygon id="xp-p27" points="412.96,670.01 494.5,752.9 494.5,670.01"/></defs><clipPath id="xp-c28"><use href="#xp-p27" style="overflow:visible"/></clipPath><rect x="380.69" y="636.91" class="xp-s13" width="147.03" height="147.67"/>',
  width: 900,
  height: 900,
});
import { registerCrossplaneMapSource } from './mapSource';
import { CompositeResourceDefinition, Composition, Configuration, CrossplaneFunction, getXRScope, Provider } from './resources';

// ── Sidebar state — updated by CrossplaneWatcher on every render cycle ────────
// registerSidebarEntryFilter is reactive (re-evaluated when sidebar re-renders),
// so module-level state is the correct bridge between React and the filter.
const claimsState = { visible: false };

// Tracks which XRD plurals have already had a sidebar entry registered so we
// don't call registerSidebarEntry more than once per plural (it appends).
const registeredXRKinds = new Set<string>();
const registeredProviders = new Set<string>();
const registeredConfigurations = new Set<string>();
const registeredFunctions = new Set<string>();
const registeredCompositions = new Set<string>();

// Guard: registerCrossplaneMapSource is idempotent (Redux skips duplicate IDs),
// but we track this ourselves to avoid re-building the sub-sources array needlessly.
let mapSourceRegistered = false;

registerSidebarEntryFilter(entry =>
  entry.name === 'crossplane-claims' && !claimsState.visible ? null : entry
);

function CrossplaneWatcher() {
  const [xrds] = CompositeResourceDefinition.useList();
  const [providers] = Provider.useList();
  const [configurations] = Configuration.useList();
  const [functions] = CrossplaneFunction.useList();
  const [compositions] = Composition.useList();

  claimsState.visible =
    xrds?.some(
      xrd => getXRScope(xrd) === 'LegacyCluster' && !!xrd.jsonData?.spec?.claimNames?.kind
    ) ?? false;

  if (xrds) {
    for (const xrd of xrds) {
      const plural = xrd.jsonData?.spec?.names?.plural as string | undefined;
      const kind = xrd.jsonData?.spec?.names?.kind as string | undefined;
      if (!plural || !kind) continue;

      const entryName = `crossplane-xr-kind-${plural}`;
      if (!registeredXRKinds.has(entryName)) {
        registeredXRKinds.add(entryName);
        registerSidebarEntry({
          parent: 'crossplane-xrs',
          name: entryName,
          label: kind,
          url: `/crossplane/xrs/${plural}`,
        });
      }

    }
  }

  if (providers) {
    for (const provider of providers) {
      const providerName = provider.metadata.name;
      if (!providerName) continue;
      const entryName = `crossplane-provider-${providerName}`;
      if (!registeredProviders.has(entryName)) {
        registeredProviders.add(entryName);
        registerSidebarEntry({
          parent: 'crossplane-providers',
          name: entryName,
          label: providerName,
          url: `/crossplane/providers/${providerName}`,
        });
      }
    }
  }

  if (configurations) {
    for (const config of configurations) {
      const configName = config.metadata.name;
      if (!configName) continue;
      const entryName = `crossplane-configuration-${configName}`;
      if (!registeredConfigurations.has(entryName)) {
        registeredConfigurations.add(entryName);
        registerSidebarEntry({
          parent: 'crossplane-configurations',
          name: entryName,
          label: configName,
          url: `/crossplane/configurations/${configName}`,
        });
      }
    }
  }

  if (functions) {
    for (const fn of functions) {
      const fnName = fn.metadata.name;
      if (!fnName) continue;
      const entryName = `crossplane-function-${fnName}`;
      if (!registeredFunctions.has(entryName)) {
        registeredFunctions.add(entryName);
        registerSidebarEntry({
          parent: 'crossplane-functions',
          name: entryName,
          label: fnName,
          url: `/crossplane/functions/${fnName}`,
        });
      }
    }
  }

  if (compositions) {
    for (const composition of compositions) {
      const compositionName = composition.metadata.name;
      if (!compositionName) continue;
      const entryName = `crossplane-composition-${compositionName}`;
      if (!registeredCompositions.has(entryName)) {
        registeredCompositions.add(entryName);
        registerSidebarEntry({
          parent: 'crossplane-compositions',
          name: entryName,
          label: compositionName,
          url: `/crossplane/compositions/${compositionName}`,
        });
      }
    }
  }

  // Register the Crossplane map source once, after XRDs have loaded.
  // useEffect fires after render so xrds is guaranteed to be populated here.
  // We use xrds as the dependency so it re-evaluates if the list grows, but
  // mapSourceRegistered prevents duplicate registration (Redux also de-dupes by ID).
  useEffect(() => {
    if (!xrds?.length || mapSourceRegistered) return;
    mapSourceRegistered = true;
    registerCrossplaneMapSource(xrds);
  }, [xrds]);

  return null;
}

registerAppBarAction(<CrossplaneWatcher />);

// ── XR condition glance ───────────────────────────────────────────────────────

function XRConditionGlance({ node }: { node: any }) {
  const conditions: Array<{ type: string; status: string; reason?: string }> =
    node?.kubeObject?.jsonData?.status?.conditions ?? [];

  const synced = conditions.find(c => c.type === 'Synced');
  const ready = conditions.find(c => c.type === 'Ready');

  if (!synced && !ready) return null;

  const notSynced = synced?.status !== 'True';
  const relevant = notSynced ? synced : ready;
  if (!relevant?.reason) return null;

  return (
    <Box display="flex" alignItems="center" gap={1} fontSize={14} mt={1}>
      <Icon icon={notSynced ? 'mdi:sync-alert' : 'mdi:heart-pulse'} />
      {relevant.reason}
    </Box>
  );
}

registerKubeObjectGlance({ id: 'crossplane-xr-condition', component: XRConditionGlance });
import { ClaimDetailPage, ClaimsPage } from './pages/ClaimsPage';
import { CompositeResourcesPage } from './pages/CompositeResourcesPage';
import { CompositionDetailPage, CompositionListPage } from './pages/CompositionListPage';
import {
  ConfigurationDetailPage,
  ConfigurationListPage,
} from './pages/ConfigurationListPage';
import { FunctionDetailPage, FunctionListPage } from './pages/FunctionListPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProviderDetailPage, ProviderListPage } from './pages/ProviderListPage';
import { XRDetailClusterPage, XRDetailNamespacedPage } from './pages/XRDetailPage';
import { XRKindPage } from './pages/XRKindPage';

// ── Sidebar ──────────────────────────────────────────────────────────────────

registerSidebarEntry({
  parent: null,
  name: 'crossplane',
  label: 'Crossplane',
  url: '/crossplane/overview',
  icon: 'crossplane:mono',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-overview',
  label: 'Overview',
  url: '/crossplane/overview',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-compositions',
  label: 'Compositions',
  url: '/crossplane/compositions',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-xrs',
  label: 'Composite Resources',
  url: '/crossplane/xrs',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-claims',
  label: 'Claims',
  url: '/crossplane/claims',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-providers',
  label: 'Providers',
  url: '/crossplane/providers',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-functions',
  label: 'Functions',
  url: '/crossplane/functions',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-configurations',
  label: 'Configurations',
  url: '/crossplane/configurations',
});

// ── Routes ───────────────────────────────────────────────────────────────────

registerRoute({
  path: '/crossplane/overview',
  sidebar: 'crossplane-overview',
  name: 'crossplane-overview',
  exact: true,
  component: () => <OverviewPage />,
});

registerRoute({
  path: '/crossplane/compositions',
  sidebar: 'crossplane-compositions',
  name: 'crossplane-compositions',
  exact: true,
  component: () => <CompositionListPage />,
});

registerRoute({
  path: '/crossplane/compositions/:name',
  sidebar: 'crossplane-compositions',
  name: 'crossplane-composition-detail',
  exact: true,
  component: () => <CompositionDetailPage />,
});

// Composite Resources (cluster-scoped: Cluster + LegacyCluster)
registerRoute({
  path: '/crossplane/xrs',
  sidebar: 'crossplane-xrs',
  name: 'crossplane-xrs',
  exact: true,
  component: () => <CompositeResourcesPage />,
});

// Per-kind list page — one entry per XRD plural
registerRoute({
  path: '/crossplane/xrs/:plural',
  sidebar: 'crossplane-xrs',
  name: 'crossplane-xr-kind',
  exact: true,
  component: () => <XRKindPage />,
});

registerRoute({
  path: '/crossplane/xrs/:plural/:name',
  sidebar: 'crossplane-xrs',
  name: 'crossplane-xr-detail-cluster',
  exact: true,
  component: () => <XRDetailClusterPage />,
});

// Composite Resources (namespaced — v2 Namespaced scope)
registerRoute({
  path: '/crossplane/xrs/:plural/:namespace/:name',
  sidebar: 'crossplane-xrs',
  name: 'crossplane-xr-detail-namespaced',
  exact: true,
  component: () => <XRDetailNamespacedPage />,
});

// Claims (LegacyCluster only)
registerRoute({
  path: '/crossplane/claims',
  sidebar: 'crossplane-claims',
  name: 'crossplane-claims',
  exact: true,
  component: () => <ClaimsPage />,
});

registerRoute({
  path: '/crossplane/claims/:plural/:namespace/:name',
  sidebar: 'crossplane-claims',
  name: 'crossplane-claim-detail',
  exact: true,
  component: () => <ClaimDetailPage />,
});

registerRoute({
  path: '/crossplane/providers',
  sidebar: 'crossplane-providers',
  name: 'crossplane-providers',
  exact: true,
  component: () => <ProviderListPage />,
});

registerRoute({
  path: '/crossplane/providers/:name',
  sidebar: 'crossplane-providers',
  name: 'crossplane-provider-detail',
  exact: true,
  component: () => <ProviderDetailPage />,
});

registerRoute({
  path: '/crossplane/functions',
  sidebar: 'crossplane-functions',
  name: 'crossplane-functions',
  exact: true,
  component: () => <FunctionListPage />,
});

registerRoute({
  path: '/crossplane/functions/:name',
  sidebar: 'crossplane-functions',
  name: 'crossplane-function-detail',
  exact: true,
  component: () => <FunctionDetailPage />,
});

registerRoute({
  path: '/crossplane/configurations',
  sidebar: 'crossplane-configurations',
  name: 'crossplane-configurations',
  exact: true,
  component: () => <ConfigurationListPage />,
});

registerRoute({
  path: '/crossplane/configurations/:name',
  sidebar: 'crossplane-configurations',
  name: 'crossplane-configuration-detail',
  exact: true,
  component: () => <ConfigurationDetailPage />,
});
