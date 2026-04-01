import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

// ── apiextensions.crossplane.io/v1 ──────────────────────────────────────────

export class CompositeResourceDefinition extends KubeObject {
  static kind = 'CompositeResourceDefinition';
  static apiName = 'compositeresourcedefinitions';
  static apiVersion = 'apiextensions.crossplane.io/v1';
  static isNamespaced = false;
}

export class Composition extends KubeObject {
  static kind = 'Composition';
  static apiName = 'compositions';
  static apiVersion = ['apiextensions.crossplane.io/v1', 'apiextensions.crossplane.io/v1beta1'];
  static isNamespaced = false;
}

export class CompositionRevision extends KubeObject {
  static kind = 'CompositionRevision';
  static apiName = 'compositionrevisions';
  static apiVersion = 'apiextensions.crossplane.io/v1';
  static isNamespaced = false;
}

// ── pkg.crossplane.io/v1 ────────────────────────────────────────────────────

export class Provider extends KubeObject {
  static kind = 'Provider';
  static apiName = 'providers';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;
}

export class ProviderRevision extends KubeObject {
  static kind = 'ProviderRevision';
  static apiName = 'providerrevisions';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;
}

export class Configuration extends KubeObject {
  static kind = 'Configuration';
  static apiName = 'configurations';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;
}

export class ConfigurationRevision extends KubeObject {
  static kind = 'ConfigurationRevision';
  static apiName = 'configurationrevisions';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;
}

export class CrossplaneFunction extends KubeObject {
  static kind = 'Function';
  static apiName = 'functions';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;
}

export class FunctionRevision extends KubeObject {
  static kind = 'FunctionRevision';
  static apiName = 'functionrevisions';
  static apiVersion = 'pkg.crossplane.io/v1';
  static isNamespaced = false;
}

// ── crossplane.io/v1alpha1 ──────────────────────────────────────────────────

export class EnvironmentConfig extends KubeObject {
  static kind = 'EnvironmentConfig';
  static apiName = 'environmentconfigs';
  static apiVersion = 'apiextensions.crossplane.io/v1alpha1';
  static isNamespaced = false;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Returns the Ready condition from a Crossplane resource's status.
 * Access via item.jsonData.status.conditions
 */
export function getReadyCondition(item: KubeObject) {
  const conditions: { type: string; status: string; reason?: string; message?: string }[] =
    item?.jsonData?.status?.conditions ?? [];
  return conditions.find(c => c.type === 'Ready') ?? null;
}

/**
 * Returns the Synced condition from a Crossplane resource's status.
 */
export function getSyncedCondition(item: KubeObject) {
  const conditions: { type: string; status: string; reason?: string; message?: string }[] =
    item?.jsonData?.status?.conditions ?? [];
  return conditions.find(c => c.type === 'Synced') ?? null;
}

/**
 * Returns the Healthy condition from a Crossplane resource's status.
 * Present on package resources (Provider, Configuration, Function).
 */
export function getHealthyCondition(item: KubeObject) {
  const conditions: { type: string; status: string; reason?: string; message?: string }[] =
    item?.jsonData?.status?.conditions ?? [];
  return conditions.find(c => c.type === 'Healthy') ?? null;
}
