import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

// ── protection.crossplane.io/v1alpha1 ───────────────────────────────────────

export class Usage extends KubeObject {
  static kind = 'Usage';
  static apiName = 'usages';
  static apiVersion = 'protection.crossplane.io/v1alpha1';
  static isNamespaced = true;
}

export class ClusterUsage extends KubeObject {
  static kind = 'ClusterUsage';
  static apiName = 'clusterusages';
  static apiVersion = 'protection.crossplane.io/v1alpha1';
  static isNamespaced = false;
}
