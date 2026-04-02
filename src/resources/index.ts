import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { makeCustomResourceClass } from '@kinvolk/headlamp-plugin/lib/lib/k8s/crd';

// ── apiextensions.crossplane.io/v1 + v2 ─────────────────────────────────────

export class CompositeResourceDefinition extends KubeObject {
  static kind = 'CompositeResourceDefinition';
  static apiName = 'compositeresourcedefinitions';
  // v2 is preferred; v1 is still served for legacy clusters
  static apiVersion = [
    'apiextensions.crossplane.io/v2',
    'apiextensions.crossplane.io/v1',
  ];
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

export class ManagedResourceDefinition extends KubeObject {
  static kind = 'ManagedResourceDefinition';
  static apiName = 'managedresourcedefinitions';
  static apiVersion = 'apiextensions.crossplane.io/v1alpha1';
  static isNamespaced = false;
}

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

/**
 * Returns the Responsive condition (v2 only) — tracks circuit-breaker state.
 */
export function getResponsiveCondition(item: KubeObject) {
  const conditions: { type: string; status: string; reason?: string; message?: string }[] =
    item?.jsonData?.status?.conditions ?? [];
  return conditions.find(c => c.type === 'Responsive') ?? null;
}

// ── XR / Claim dynamic class helpers ────────────────────────────────────────

/**
 * The three XR scope modes that exist across Crossplane v1 and v2.
 * - Namespaced:    v2 default; XR lives in a namespace; no claims.
 * - Cluster:       v2 explicit; cluster-scoped XR; no claims.
 * - LegacyCluster: v1 implicit; cluster-scoped XR + claims supported.
 */
export type XRScope = 'Namespaced' | 'Cluster' | 'LegacyCluster';

/**
 * Reads the scope from an XRD object.
 * v1 XRDs have no spec.scope → treated as LegacyCluster.
 */
export function getXRScope(xrd: KubeObject): XRScope {
  const scope = xrd.jsonData?.spec?.scope as string | undefined;
  if (scope === 'Namespaced' || scope === 'Cluster') return scope;
  return 'LegacyCluster';
}

/**
 * Creates a dynamic KubeObject class for the Composite Resources (XRs)
 * defined by the given XRD. Uses only XRD spec fields — no CRD lookup needed.
 */
export function makeXRClass(xrd: KubeObject) {
  const spec = xrd.jsonData?.spec;
  const scope = getXRScope(xrd);

  const apiInfo = (spec.versions ?? [])
    .filter((v: any) => v.served !== false)
    .map((v: any) => ({ group: spec.group, version: v.name }));

  return makeCustomResourceClass({
    apiInfo,
    kind: spec.names.kind,
    pluralName: spec.names.plural,
    singularName: spec.names.singular ?? spec.names.kind.toLowerCase(),
    isNamespaced: scope === 'Namespaced',
  });
}

/**
 * Creates a dynamic KubeObject class for the Claims defined by an XRD.
 * Only valid for LegacyCluster-scope XRDs that have spec.claimNames set.
 * Returns null if this XRD does not offer claims.
 */
export function makeClaimClass(xrd: KubeObject) {
  const spec = xrd.jsonData?.spec;
  if (!spec?.claimNames?.kind) return null;

  const apiInfo = (spec.versions ?? [])
    .filter((v: any) => v.served !== false)
    .map((v: any) => ({ group: spec.group, version: v.name }));

  return makeCustomResourceClass({
    apiInfo,
    kind: spec.claimNames.kind,
    pluralName: spec.claimNames.plural,
    singularName: spec.claimNames.singular ?? spec.claimNames.kind.toLowerCase(),
    isNamespaced: true, // Claims are always namespace-scoped
  });
}

/**
 * Returns the composition reference name from an XR, handling v1 (flat)
 * and v2 (nested under spec.crossplane) layouts.
 */
export function getCompositionRef(item: KubeObject, scope: XRScope): string {
  if (scope === 'LegacyCluster') {
    return item.jsonData?.spec?.compositionRef?.name ?? '-';
  }
  return item.jsonData?.spec?.crossplane?.compositionRef?.name ?? '-';
}
