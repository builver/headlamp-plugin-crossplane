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

  if (mrds && providers) {
    for (const mrd of mrds) {
      const mrdName = mrd.metadata.name;
      const kind = mrd.jsonData?.spec?.names?.kind;
      if (!mrdName || !kind) continue;

      const ownerRef = mrd.metadata?.ownerReferences?.find(
        (ref: any) => ref.kind === 'Provider'
      );
      if (!ownerRef) continue;

      const ownerProvider = providers.find(p => p.metadata.uid === ownerRef.uid);
      if (!ownerProvider) continue;

      const providerName = ownerProvider.metadata.name;
      const entryName = `crossplane-mrd-${mrdName}`;
      if (!registeredMRDs.has(entryName)) {
        registeredMRDs.add(entryName);
        registerSidebarEntry({
          parent: `crossplane-provider-${providerName}`,
          name: entryName,
          label: kind,
          url: `/crossplane/mrds/${mrdName}`,
        });
        registerRoute({
          path: `/crossplane/mrds/${mrdName}`,
          sidebar: entryName,
          name: `crossplane-mrd-detail-${mrdName}`,
          exact: true,
          component: () => <MRDDetailPage />,
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
import { MRDDetailPage } from './pages/MRDDetailPage';
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
