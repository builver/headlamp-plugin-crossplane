import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import {
  getHealthyCondition,
  getInstalledCondition,
  getReadyCondition,
  getSyncedCondition,
} from '../resources';
import { HealthyStatus, InstalledStatus, ReadyStatus, SyncedStatus } from './ConditionStatus';

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
