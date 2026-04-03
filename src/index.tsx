import { addIcon } from '@iconify/react';
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
  body: '<g fill="currentColor"><path d="M263.62,234.54c-0.13,2.87-0.2,5.76-0.2,8.68c0,3.19,0.07,6.35,0.24,9.5c-0.07,1.55-0.24,3.08-0.24,4.66v306.18c0,58.55,47.91,106.46,106.46,106.46h160.22c58.56,0,106.46-47.91,106.46-106.46V257.37c0-1.78-0.18-3.51-0.28-5.26c0.14-2.95,0.22-5.92,0.22-8.89c0-2.92-0.07-5.8-0.2-8.68C631.8,135.53,550.1,56.66,449.98,56.66C349.85,56.66,268.14,135.53,263.62,234.54z"/><path d="M447.73,309.78c-25.83,0-46.76,20.94-46.76,46.76v440.04c0,25.83,20.94,46.76,46.76,46.76s46.76-20.93,46.76-46.76V356.55C494.5,330.72,473.56,309.78,447.73,309.78"/><polygon points="412.96,670.01 494.5,752.9 494.5,670.01"/></g>',
  width: 900,
  height: 900,
});
import { ReadyStatus, SyncedStatus } from './components/ConditionStatus';
import { registerCrossplaneMapSource } from './mapSource';
import { CompositeResourceDefinition, Composition, Configuration, CrossplaneFunction, getXRScope, ManagedResourceDefinition, Provider } from './resources';

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
const registeredMRDs = new Set<string>();

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
  const [mrds] = ManagedResourceDefinition.useList();

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
        registerRoute({
          path: `/crossplane/xrs/${plural}`,
          sidebar: entryName,
          name: entryName,
          exact: true,
          component: () => <XRKindPage />,
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
        registerRoute({
          path: `/crossplane/providers/${providerName}`,
          sidebar: entryName,
          name: `crossplane-provider-detail-${providerName}`,
          exact: true,
          component: () => <ProviderDetailPage />,
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
        registerRoute({
          path: `/crossplane/configurations/${configName}`,
          sidebar: entryName,
          name: `crossplane-configuration-detail-${configName}`,
          exact: true,
          component: () => <ConfigurationDetailPage />,
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
        registerRoute({
          path: `/crossplane/functions/${fnName}`,
          sidebar: entryName,
          name: `crossplane-function-detail-${fnName}`,
          exact: true,
          component: () => <FunctionDetailPage />,
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
        registerRoute({
          path: `/crossplane/compositions/${compositionName}`,
          sidebar: entryName,
          name: `crossplane-composition-detail-${compositionName}`,
          exact: true,
          component: () => <CompositionDetailPage />,
        });
      }
    }
  }

  if (mrds) {
    for (const mrd of mrds) {
      const mrdName = mrd.metadata.name;
      if (!mrdName || registeredMRDs.has(mrdName)) continue;
      registeredMRDs.add(mrdName);
      registerRoute({
        path: `/crossplane/mrds/${mrdName}`,
        sidebar: 'crossplane-mrds',
        name: `crossplane-mrd-detail-${mrdName}`,
        exact: true,
        component: () => <MRDDetailPage />,
      });
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
  const item = node?.kubeObject;
  const conditions: Array<{ type: string }> = item?.jsonData?.status?.conditions ?? [];

  if (!conditions.some(c => c.type === 'Ready' || c.type === 'Synced')) return null;

  return (
    <Box display="flex" alignItems="center" gap={1} mt={1}>
      <ReadyStatus item={item} />
      <SyncedStatus item={item} />
    </Box>
  );
}

registerKubeObjectGlance({ id: 'crossplane-xr-condition', component: XRConditionGlance });
import { ClaimDetailPage, ClaimsPage } from './pages/ClaimsPage';
import { MRDDetailPage, MRDListPage } from './pages/MRDDetailPage';
import {
  MRInstanceDetailClusterPage,
  MRInstanceDetailNamespacedPage,
  MRInstanceListPage,
} from './pages/MRInstancePage';
import { CompositeResourcesPage } from './pages/CompositeResourcesPage';
import { CompositionDetailPage, CompositionListPage } from './pages/CompositionListPage';
import {
  ConfigurationDetailPage,
  ConfigurationListPage,
} from './pages/ConfigurationListPage';
import { FunctionDetailPage, FunctionListPage } from './pages/FunctionListPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProviderDetailPage, ProviderListPage } from './pages/ProviderListPage';
import { XRDDetailPage } from './pages/XRDDetailPage';
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

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-mrds',
  label: 'Managed Resources',
  url: '/crossplane/mrds',
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
  path: '/crossplane/xrds/:name',
  sidebar: 'crossplane-xrs',
  name: 'crossplane-xrd-detail',
  exact: true,
  component: () => <XRDDetailPage />,
});

registerRoute({
  path: '/crossplane/compositions',
  sidebar: 'crossplane-compositions',
  name: 'crossplane-compositions',
  exact: true,
  component: () => <CompositionListPage />,
});


// Composite Resources (cluster-scoped: Cluster + LegacyCluster)
registerRoute({
  path: '/crossplane/xrs',
  sidebar: 'crossplane-xrs',
  name: 'crossplane-xrs',
  exact: true,
  component: () => <CompositeResourcesPage />,
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
  path: '/crossplane/mrds',
  sidebar: 'crossplane-mrds',
  name: 'crossplane-mrds-list',
  exact: true,
  component: () => <MRDListPage />,
});

registerRoute({
  path: '/crossplane/mrds/:mrdName/resources',
  sidebar: 'crossplane-mrds',
  name: 'crossplane-mr-list',
  exact: true,
  component: () => <MRInstanceListPage />,
});

registerRoute({
  path: '/crossplane/mrds/:mrdName/resources/:name',
  sidebar: 'crossplane-mrds',
  name: 'crossplane-mr-detail-cluster',
  exact: true,
  component: () => <MRInstanceDetailClusterPage />,
});

registerRoute({
  path: '/crossplane/mrds/:mrdName/resources/:namespace/:name',
  sidebar: 'crossplane-mrds',
  name: 'crossplane-mr-detail-namespaced',
  exact: true,
  component: () => <MRInstanceDetailNamespacedPage />,
});

registerRoute({
  path: '/crossplane/providers',
  sidebar: 'crossplane-providers',
  name: 'crossplane-providers',
  exact: true,
  component: () => <ProviderListPage />,
});

registerRoute({
  path: '/crossplane/functions',
  sidebar: 'crossplane-functions',
  name: 'crossplane-functions',
  exact: true,
  component: () => <FunctionListPage />,
});


registerRoute({
  path: '/crossplane/configurations',
  sidebar: 'crossplane-configurations',
  name: 'crossplane-configurations',
  exact: true,
  component: () => <ConfigurationListPage />,
});

