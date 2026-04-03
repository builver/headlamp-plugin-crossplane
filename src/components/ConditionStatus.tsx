import { StatusLabel } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Tooltip, Typography } from '@mui/material';
import { getHealthyCondition, getInstalledCondition, getReadyCondition, getSyncedCondition } from '../resources';

interface ReadyStatusProps {
  item: KubeObject;
}

/**
 * Displays the Ready condition of a Crossplane resource.
 * Mirrors the pattern from the Flux plugin's StatusLabel.
 */
export function ReadyStatus({ item }: ReadyStatusProps) {
  const ready = getReadyCondition(item);

  if (!ready) {
    return <span>-</span>;
  }

  if (ready.status === 'Unknown') {
    return <StatusLabel status="warning">Reconciling…</StatusLabel>;
  }

  const isReady = ready.status === 'True';
  return (
    <StatusLabel status={isReady ? 'success' : 'error'}>
      <Tooltip title={ready.message ?? ''}>
        <Typography component="span">{isReady ? 'Ready' : ready.reason ?? 'Not Ready'}</Typography>
      </Tooltip>
    </StatusLabel>
  );
}

export function InstalledStatus({ item }: { item: KubeObject }) {
  const installed = getInstalledCondition(item);

  if (!installed) {
    return <span>-</span>;
  }

  if (installed.status === 'Unknown') {
    return <StatusLabel status="warning">Installing…</StatusLabel>;
  }

  const isInstalled = installed.status === 'True';
  return (
    <StatusLabel status={isInstalled ? 'success' : 'error'}>
      <Tooltip title={installed.message ?? ''}>
        <Typography component="span">{isInstalled ? 'Installed' : installed.reason ?? 'Not Installed'}</Typography>
      </Tooltip>
    </StatusLabel>
  );
}

export function HealthyStatus({ item }: { item: KubeObject }) {
  const healthy = getHealthyCondition(item);

  if (!healthy) {
    return <span>-</span>;
  }

  if (healthy.status === 'Unknown') {
    return <StatusLabel status="warning">Unknown</StatusLabel>;
  }

  const isHealthy = healthy.status === 'True';
  return (
    <StatusLabel status={isHealthy ? 'success' : 'error'}>
      <Tooltip title={healthy.message ?? ''}>
        <Typography component="span">{isHealthy ? 'Healthy' : healthy.reason ?? 'Unhealthy'}</Typography>
      </Tooltip>
    </StatusLabel>
  );
}

interface SyncedStatusProps {
  item: KubeObject;
}

/**
 * Displays the Synced condition of a Crossplane resource.
 * Most Crossplane managed resources expose both Ready and Synced conditions.
 */
export function SyncedStatus({ item }: SyncedStatusProps) {
  const synced = getSyncedCondition(item);

  if (!synced) {
    return <span>-</span>;
  }

  if (synced.status === 'Unknown') {
    return <StatusLabel status="warning">Unknown</StatusLabel>;
  }

  const isSynced = synced.status === 'True';
  return (
    <StatusLabel status={isSynced ? 'success' : 'error'}>
      <Tooltip title={synced.message ?? ''}>
        <Typography component="span">{isSynced ? 'Synced' : synced.reason ?? 'Not Synced'}</Typography>
      </Tooltip>
    </StatusLabel>
  );
}
