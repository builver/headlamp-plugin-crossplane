/** Known Kubernetes native resource kinds that have owner-reference children. */
export const OWNER_REF_CHILDREN: Record<string, Array<{ kind: string; apiVersion: string }>> = {
  Deployment:  [{ kind: 'ReplicaSet', apiVersion: 'apps/v1' }],
  ReplicaSet:  [{ kind: 'Pod',        apiVersion: 'v1' }],
  StatefulSet: [{ kind: 'Pod',        apiVersion: 'v1' }],
  DaemonSet:   [{ kind: 'Pod',        apiVersion: 'v1' }],
  Job:         [{ kind: 'Pod',        apiVersion: 'v1' }],
  CronJob:     [{ kind: 'Job',        apiVersion: 'batch/v1' }],
};

export const MAX_DEPTH = 5;
