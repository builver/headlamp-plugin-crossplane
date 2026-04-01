import {
  registerAppBarAction,
  registerRoute,
  registerSidebarEntry,
  registerSidebarEntryFilter,
} from '@kinvolk/headlamp-plugin/lib';
import { CompositeResourceDefinition, getXRScope } from './resources';

// ── Sidebar state — updated by CrossplaneWatcher on every render cycle ────────
// registerSidebarEntryFilter is reactive (re-evaluated when sidebar re-renders),
// so module-level state is the correct bridge between React and the filter.
const claimsState = { visible: false };

// Tracks which XRD plurals have already had a sidebar entry registered so we
// don't call registerSidebarEntry more than once per plural (it appends).
const registeredXRKinds = new Set<string>();

registerSidebarEntryFilter(entry =>
  entry.name === 'crossplane-claims' && !claimsState.visible ? null : entry
);

function CrossplaneWatcher() {
  const [xrds] = CompositeResourceDefinition.useList();

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

  return null;
}

registerAppBarAction(<CrossplaneWatcher />);
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
import { XRDDetailPage, XRDListPage } from './pages/XRDListPage';

// ── Sidebar ──────────────────────────────────────────────────────────────────

registerSidebarEntry({
  parent: null,
  name: 'crossplane',
  label: 'Crossplane',
  url: '/crossplane/overview',
  icon: 'mdi:cloud-outline',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-overview',
  label: 'Overview',
  url: '/crossplane/overview',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-xrds',
  label: 'XRDs',
  url: '/crossplane/xrds',
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
  path: '/crossplane/xrds',
  sidebar: 'crossplane-xrds',
  name: 'crossplane-xrds',
  exact: true,
  component: () => <XRDListPage />,
});

registerRoute({
  path: '/crossplane/xrds/:name',
  sidebar: 'crossplane-xrds',
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
