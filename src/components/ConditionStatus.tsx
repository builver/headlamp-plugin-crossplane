import { StatusLabel } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Tooltip, Typography } from '@mui/material';
import { type Condition, getHealthyCondition, getInstalledCondition, getReadyCondition, getRevisionHealthyCondition, getRuntimeHealthyCondition, getSyncedCondition } from '../resources';

function renderConditionStatus(
  cond: Condition | null,
  unknownLabel: string,
  trueLabel: string,
  falseLabel: string,
): JSX.Element {
  if (!cond) return <span>-</span>;
  if (cond.status === 'Unknown') return <StatusLabel status="warning">{unknownLabel}</StatusLabel>;
  const ok = cond.status === 'True';
  return (
    <StatusLabel status={ok ? 'success' : 'error'}>
      <Tooltip title={cond.message ?? ''}>
        <Typography component="span">{ok ? trueLabel : cond.reason ?? falseLabel}</Typography>
      </Tooltip>
    </StatusLabel>
  );
}

export function ReadyStatus({ item }: { item: KubeObject }) {
  return renderConditionStatus(getReadyCondition(item), 'Reconciling…', 'Ready', 'Not Ready');
}

export function InstalledStatus({ item }: { item: KubeObject }) {
  return renderConditionStatus(getInstalledCondition(item), 'Installing…', 'Installed', 'Not Installed');
}

export function HealthyStatus({ item }: { item: KubeObject }) {
  return renderConditionStatus(getHealthyCondition(item), 'Unknown', 'Healthy', 'Unhealthy');
}

export function RuntimeHealthyStatus({ item }: { item: KubeObject }) {
  return renderConditionStatus(getRuntimeHealthyCondition(item), 'Unknown', 'Runtime Healthy', 'Runtime Unhealthy');
}

export function RevisionHealthyStatus({ item }: { item: KubeObject }) {
  return renderConditionStatus(getRevisionHealthyCondition(item), 'Unknown', 'Revision Healthy', 'Revision Unhealthy');
}

export function SyncedStatus({ item }: { item: KubeObject }) {
  return renderConditionStatus(getSyncedCondition(item), 'Unknown', 'Synced', 'Not Synced');
}
