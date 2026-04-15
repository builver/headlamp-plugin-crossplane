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

/**
 * Hardcoded plural names for native K8s resources encountered during BFS
 * expansion (owner-ref children). CRD-based resources use the CRD list instead.
 */
export const NATIVE_PLURALS: Record<string, string> = {
  'apps/Deployment':        'deployments',
  'apps/ReplicaSet':        'replicasets',
  'apps/StatefulSet':       'statefulsets',
  'apps/DaemonSet':         'daemonsets',
  'batch/Job':              'jobs',
  'batch/CronJob':          'cronjobs',
  '/Pod':                   'pods',
  '/Service':               'services',
  '/PersistentVolumeClaim': 'persistentvolumeclaims',
  '/ConfigMap':             'configmaps',
  '/Secret':                'secrets',
  '/ServiceAccount':        'serviceaccounts',
};
