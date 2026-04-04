import { Link } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Box, Typography } from '@mui/material';
import {
  getHealthyCondition,
  getInstalledCondition,
  getReadyCondition,
  getSyncedCondition,
  XRScope,
} from '../resources';
import { HealthyStatus, InstalledStatus, ReadyStatus, SyncedStatus } from './ConditionStatus';

/**
 * Name column for XR tables — links to the correct detail route based on scope.
 */
export function makeXRNameColumn(plural: string, scope: XRScope) {
  const isNamespaced = scope === 'Namespaced';
  const detailRoute = isNamespaced
    ? `crossplane-xr-detail-namespaced-${plural}`
    : `crossplane-xr-detail-cluster-${plural}`;
  return {
    label: 'Name',
    getValue: (item: KubeObject) => item.metadata.name,
    render: (item: KubeObject) => {
      const params = isNamespaced
        ? { plural, namespace: item.metadata.namespace, name: item.metadata.name }
        : { plural, name: item.metadata.name };
      return <Link routeName={detailRoute} params={params}>{item.metadata.name}</Link>;
    },
  };
}

/**
 * Ready condition column — used in XR and Claim tables.
 */
export const readyColumn = {
  label: 'Ready',
  getValue: (item: KubeObject) => getReadyCondition(item)?.status ?? '-',
  render: (item: KubeObject) => <ReadyStatus item={item} />,
};

/**
 * Synced condition column — used in XR and Claim tables.
 */
export const syncedColumn = {
  label: 'Synced',
  getValue: (item: KubeObject) => getSyncedCondition(item)?.status ?? '-',
  render: (item: KubeObject) => <SyncedStatus item={item} />,
};

/**
 * Composite Type column — shows Kind (linked to XR list) + apiVersion in subtle style.
 * Pass the current xrds list so the render can resolve plural for the route link.
 */
export function makeCompositeTypeColumn(xrds: KubeObject[] | null) {
  // Pre-build a lookup map (kind/group → plural) once per xrds snapshot
  const pluralByKindGroup = new Map(
    (xrds ?? []).map(x => [
      `${x.jsonData?.spec?.names?.kind}/${x.jsonData?.spec?.group}`,
      x.jsonData?.spec?.names?.plural as string | undefined,
    ])
  );
  return {
    label: 'Composite Type',
    getValue: (item: KubeObject) => {
      const ref = item.jsonData?.spec?.compositeTypeRef;
      return ref ? `${ref.apiVersion}/${ref.kind}` : '-';
    },
    render: (item: KubeObject) => {
      const ref = item.jsonData?.spec?.compositeTypeRef;
      if (!ref) return <span>-</span>;
      const group = (ref.apiVersion as string)?.split('/')[0] ?? '';
      const plural = pluralByKindGroup.get(`${ref.kind}/${group}`);
      return (
        <Box display="flex" alignItems="center" gap={1}>
          {plural
            ? <Link routeName={`crossplane-xr-kind-${plural}`}>{ref.kind}</Link>
            : ref.kind
          }
          <Typography variant="caption" color="text.secondary">{ref.apiVersion}</Typography>
        </Box>
      );
    },
  };
}

/**
 * Shared columns for Provider, Function, and Configuration list tables.
 * All three package resource types expose the same fields.
 */
export const packageResourceColumns = [
  {
    label: 'Package',
    getValue: (item: KubeObject) => item.jsonData?.spec?.package ?? '-',
  },
  {
    label: 'Installed',
    getValue: (item: KubeObject) => getInstalledCondition(item)?.status ?? '-',
    render: (item: KubeObject) => <InstalledStatus item={item} />,
  },
  {
    label: 'Healthy',
    getValue: (item: KubeObject) => getHealthyCondition(item)?.status ?? '-',
    render: (item: KubeObject) => <HealthyStatus item={item} />,
  },
  {
    label: 'Current Revision',
    getValue: (item: KubeObject) => item.jsonData?.status?.currentRevision ?? '-',
  },
  'age' as const,
];
