import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

// ── ops.crossplane.io/v1alpha1 ──────────────────────────────────────────────

export class Operation extends KubeObject {
  static kind = 'Operation';
  static apiName = 'operations';
  static apiVersion = 'ops.crossplane.io/v1alpha1';
  static isNamespaced = false;
}

export class CronOperation extends KubeObject {
  static kind = 'CronOperation';
  static apiName = 'cronoperations';
  static apiVersion = 'ops.crossplane.io/v1alpha1';
  static isNamespaced = false;
}

export class WatchOperation extends KubeObject {
  static kind = 'WatchOperation';
  static apiName = 'watchoperations';
  static apiVersion = 'ops.crossplane.io/v1alpha1';
  static isNamespaced = false;
}
