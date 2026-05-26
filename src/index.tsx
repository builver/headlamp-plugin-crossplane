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
import { registerCrossplaneMapSource } from './components/mapSource';
import { CompositeResourceDefinition, getXRScope } from './resources';

// ── Sidebar state — updated by CrossplaneWatcher on every render cycle ────────
// registerSidebarEntryFilter is reactive (re-evaluated when sidebar re-renders),
// so module-level state is the correct bridge between React and the filter.
const claimsState = { visible: false };

// Guard: registerCrossplaneMapSource is idempotent (Redux skips duplicate IDs),
// but we track this ourselves to avoid re-building the sub-sources array needlessly.
let mapSourceRegistered = false;

registerSidebarEntryFilter(entry =>
  entry.name === 'crossplane-claims' && !claimsState.visible ? null : entry
);

function CrossplaneWatcher() {
  const [xrds] = CompositeResourceDefinition.useList();

  claimsState.visible =
    xrds?.some(
      xrd => getXRScope(xrd) === 'LegacyCluster' && !!xrd.jsonData?.spec?.claimNames?.kind
    ) ?? false;

  // Register the Crossplane map source once xrds has loaded (even if empty), so the
  // map appears as soon as Crossplane is installed rather than waiting for the first
  // XR instance. Waiting for xrds specifically (not just any list) ensures sub-sources
  // are built from the correct XRD snapshot rather than an empty fallback.
  useEffect(() => {
    if (xrds === null || mapSourceRegistered) return;
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
import { ClaimDetailPage, ClaimsPage } from './features/composites/ClaimsPage';
import { ClusterUsageDetailPage, UsageDetailPage, UsageListPage } from './features/composites/UsageListPage';
import { XRDDetailPage } from './features/composites/XRDDetailPage';
import { XRDetailClusterPage, XRDetailNamespacedPage } from './features/composites/XRDetailPage';
import { XRDListPage } from './features/composites/XRDListPage';
import { XRListPage } from './features/composites/XRListPage';
import { CompositionDetailRoute } from './features/compositions/CompositionDetailPage';
import { CompositionListPage } from './features/compositions/CompositionListPage';
import { EnvironmentConfigDetailPage, EnvironmentConfigListPage } from './features/compositions/EnvironmentConfigListPage';
import { MRAPDetailPage, MRAPListPage } from './features/managed/MRAPPage';
import { MRDDetailPage, MRDListPage } from './features/managed/MRDDetailPage';
import {
  MRDetailClusterPage,
  MRDetailNamespacedPage,
  MRListPage,
} from './features/managed/MRDetailPage';
import { CronOperationDetailPage, CronOperationListPage } from './features/operations/CronOperationListPage';
import { OperationDetailPage, OperationListPage } from './features/operations/OperationListPage';
import { WatchOperationDetailPage, WatchOperationListPage } from './features/operations/WatchOperationListPage';
import { OverviewPage } from './features/overview/OverviewPage';
import {
  ConfigurationDetailPage,
  ConfigurationListPage,
} from './features/packages/ConfigurationListPage';
import { FunctionDetailPage, FunctionListPage } from './features/packages/FunctionListPage';
import { ImageConfigDetailPage, ImageConfigListPage } from './features/packages/ImageConfigListPage';
import { ProviderDetailPage, ProviderListPage } from './features/packages/ProviderListPage';
import { RuntimeConfigDetailPage, RuntimeConfigListPage } from './features/packages/RuntimeConfigListPage';

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
  parent: 'crossplane-compositions',
  name: 'crossplane-envconfigs',
  label: 'Environment Configs',
  url: '/crossplane/envconfigs',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-operations',
  label: 'Operations',
  url: '/crossplane/operations',
});

registerSidebarEntry({
  parent: 'crossplane-operations',
  name: 'crossplane-operations-list',
  label: 'Operations',
  url: '/crossplane/operations',
});

registerSidebarEntry({
  parent: 'crossplane-operations',
  name: 'crossplane-cronoperations',
  label: 'Cron Operations',
  url: '/crossplane/cronoperations',
});

registerSidebarEntry({
  parent: 'crossplane-operations',
  name: 'crossplane-watchoperations',
  label: 'Watch Operations',
  url: '/crossplane/watchoperations',
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
  name: 'crossplane-packages',
  label: 'Packages',
  url: '/crossplane/providers',
});

registerSidebarEntry({
  parent: 'crossplane-packages',
  name: 'crossplane-providers',
  label: 'Providers',
  url: '/crossplane/providers',
});

registerSidebarEntry({
  parent: 'crossplane-packages',
  name: 'crossplane-functions',
  label: 'Functions',
  url: '/crossplane/functions',
});

registerSidebarEntry({
  parent: 'crossplane-packages',
  name: 'crossplane-configurations',
  label: 'Configurations',
  url: '/crossplane/configurations',
});

registerSidebarEntry({
  parent: 'crossplane-packages',
  name: 'crossplane-imageconfigs',
  label: 'Image Configs',
  url: '/crossplane/imageconfigs',
});

registerSidebarEntry({
  parent: 'crossplane-packages',
  name: 'crossplane-runtimeconfigs',
  label: 'Runtime Configs',
  url: '/crossplane/runtimeconfigs',
});

registerSidebarEntry({
  parent: 'crossplane-xrs',
  name: 'crossplane-usages',
  label: 'Usages',
  url: '/crossplane/usages',
});

registerSidebarEntry({
  parent: 'crossplane',
  name: 'crossplane-mrds',
  label: 'Managed Resources',
  url: '/crossplane/mrds',
});

registerSidebarEntry({
  parent: 'crossplane-mrds',
  name: 'crossplane-mraps',
  label: 'Activation Policies',
  url: '/crossplane/mraps',
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
  component: () => <CompositionDetailRoute />,
});


// Composite Resources (cluster-scoped: Cluster + LegacyCluster)
registerRoute({
  path: '/crossplane/xrs',
  sidebar: 'crossplane-xrs',
  name: 'crossplane-xrs',
  exact: true,
  component: () => <XRDListPage />,
});

registerRoute({
  path: '/crossplane/xrs/:plural',
  sidebar: 'crossplane-xrs',
  name: 'crossplane-xr-list',
  exact: true,
  component: () => <XRListPage />,
});

registerRoute({
  path: '/crossplane/xrs/:plural/:name',
  sidebar: 'crossplane-xrs',
  name: 'crossplane-xr-detail-cluster',
  exact: true,
  component: () => <XRDetailClusterPage />,
});

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
  path: '/crossplane/mrds/:name',
  sidebar: 'crossplane-mrds',
  name: 'crossplane-mrd-detail',
  exact: true,
  component: () => <MRDDetailPage />,
});

registerRoute({
  path: '/crossplane/mraps',
  sidebar: 'crossplane-mraps',
  name: 'crossplane-mraps-list',
  exact: true,
  component: () => <MRAPListPage />,
});

registerRoute({
  path: '/crossplane/mraps/:name',
  sidebar: 'crossplane-mraps',
  name: 'crossplane-mrap-detail',
  exact: true,
  component: () => <MRAPDetailPage />,
});

registerRoute({
  path: '/crossplane/mrds/:mrdName/resources',
  sidebar: 'crossplane-mrds',
  name: 'crossplane-mr-list',
  exact: true,
  component: () => <MRListPage />,
});

registerRoute({
  path: '/crossplane/mrds/:mrdName/resources/:name',
  sidebar: 'crossplane-mrds',
  name: 'crossplane-mr-detail-cluster',
  exact: true,
  component: () => <MRDetailClusterPage />,
});

registerRoute({
  path: '/crossplane/mrds/:mrdName/resources/:namespace/:name',
  sidebar: 'crossplane-mrds',
  name: 'crossplane-mr-detail-namespaced',
  exact: true,
  component: () => <MRDetailNamespacedPage />,
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

registerRoute({
  path: '/crossplane/imageconfigs',
  sidebar: 'crossplane-imageconfigs',
  name: 'crossplane-imageconfigs',
  exact: true,
  component: () => <ImageConfigListPage />,
});

registerRoute({
  path: '/crossplane/imageconfigs/:name',
  sidebar: 'crossplane-imageconfigs',
  name: 'crossplane-imageconfig-detail',
  exact: true,
  component: () => <ImageConfigDetailPage />,
});

registerRoute({
  path: '/crossplane/runtimeconfigs',
  sidebar: 'crossplane-runtimeconfigs',
  name: 'crossplane-runtimeconfigs',
  exact: true,
  component: () => <RuntimeConfigListPage />,
});

registerRoute({
  path: '/crossplane/runtimeconfigs/:name',
  sidebar: 'crossplane-runtimeconfigs',
  name: 'crossplane-runtimeconfig-detail',
  exact: true,
  component: () => <RuntimeConfigDetailPage />,
});

registerRoute({
  path: '/crossplane/envconfigs',
  sidebar: 'crossplane-envconfigs',
  name: 'crossplane-envconfigs',
  exact: true,
  component: () => <EnvironmentConfigListPage />,
});

registerRoute({
  path: '/crossplane/envconfigs/:name',
  sidebar: 'crossplane-envconfigs',
  name: 'crossplane-envconfig-detail',
  exact: true,
  component: () => <EnvironmentConfigDetailPage />,
});

registerRoute({
  path: '/crossplane/usages',
  sidebar: 'crossplane-usages',
  name: 'crossplane-usages',
  exact: true,
  component: () => <UsageListPage />,
});

registerRoute({
  path: '/crossplane/usages/:namespace/:name',
  sidebar: 'crossplane-usages',
  name: 'crossplane-usage-detail',
  exact: true,
  component: () => <UsageDetailPage />,
});

registerRoute({
  path: '/crossplane/usages/cluster/:name',
  sidebar: 'crossplane-usages',
  name: 'crossplane-cluster-usage-detail',
  exact: true,
  component: () => <ClusterUsageDetailPage />,
});

registerRoute({
  path: '/crossplane/operations',
  sidebar: 'crossplane-operations-list',
  name: 'crossplane-operations',
  exact: true,
  component: () => <OperationListPage />,
});

registerRoute({
  path: '/crossplane/operations/:name',
  sidebar: 'crossplane-operations-list',
  name: 'crossplane-operation-detail',
  exact: true,
  component: () => <OperationDetailPage />,
});

registerRoute({
  path: '/crossplane/cronoperations',
  sidebar: 'crossplane-cronoperations',
  name: 'crossplane-cronoperations',
  exact: true,
  component: () => <CronOperationListPage />,
});

registerRoute({
  path: '/crossplane/cronoperations/:name',
  sidebar: 'crossplane-cronoperations',
  name: 'crossplane-cronoperation-detail',
  exact: true,
  component: () => <CronOperationDetailPage />,
});

registerRoute({
  path: '/crossplane/watchoperations',
  sidebar: 'crossplane-watchoperations',
  name: 'crossplane-watchoperations',
  exact: true,
  component: () => <WatchOperationListPage />,
});

registerRoute({
  path: '/crossplane/watchoperations/:name',
  sidebar: 'crossplane-watchoperations',
  name: 'crossplane-watchoperation-detail',
  exact: true,
  component: () => <WatchOperationDetailPage />,
});

