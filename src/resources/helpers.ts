// Pure utility functions with no headlamp-plugin dependency.
// Using a minimal structural interface so callers can pass KubeObject instances
// (structural typing: KubeObject has jsonData, so it satisfies this interface).
interface JsonHolder {
  jsonData?: any;
}

export type Condition = { type: string; status: string; reason?: string; message?: string };

function findCondition(item: JsonHolder, type: string): Condition | null {
  const conditions: Condition[] = item?.jsonData?.status?.conditions ?? [];
  return conditions.find(c => c.type === type) ?? null;
}

export const getReadyCondition           = (item: JsonHolder) => findCondition(item, 'Ready');
export const getSyncedCondition          = (item: JsonHolder) => findCondition(item, 'Synced');
/** Present on pkg.crossplane.io resources (Provider, Configuration, Function). */
export const getInstalledCondition       = (item: JsonHolder) => findCondition(item, 'Installed');
/** Present on package resources (Provider, Configuration, Function). */
export const getHealthyCondition         = (item: JsonHolder) => findCondition(item, 'Healthy');
/** ProviderRevision: whether the runtime Deployment/Pod is healthy. */
export const getRuntimeHealthyCondition  = (item: JsonHolder) => findCondition(item, 'RuntimeHealthy');
/** ProviderRevision: whether the revision itself is healthy. */
export const getRevisionHealthyCondition = (item: JsonHolder) => findCondition(item, 'RevisionHealthy');
/** v2 only — tracks circuit-breaker state. */
export const getResponsiveCondition      = (item: JsonHolder) => findCondition(item, 'Responsive');

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
export function getXRScope(xrd: JsonHolder): XRScope {
  const scope = xrd.jsonData?.spec?.scope as string | undefined;
  if (scope === 'Namespaced' || scope === 'Cluster') return scope;
  return 'LegacyCluster';
}

/**
 * Returns the composition reference name from an XR, handling v1 (flat)
 * and v2 (nested under spec.crossplane) layouts.
 */
export function getCompositionRef(item: JsonHolder, scope: XRScope): string {
  if (scope === 'LegacyCluster') {
    return item.jsonData?.spec?.compositionRef?.name ?? '-';
  }
  return item.jsonData?.spec?.crossplane?.compositionRef?.name ?? '-';
}

// ── Pipeline / kro helpers ────────────────────────────────────────────────────

export interface RequiredResource {
  requirementName: string;
  apiVersion: string;
  kind: string;
  name?: string;
  matchLabels?: Record<string, string>;
  namespace?: string;
}

export interface RequiredSchema {
  requirementName: string;
  apiVersion: string;
  kind: string;
}

export interface PipelineStepRequirements {
  requiredResources?: RequiredResource[];
  requiredSchemas?: RequiredSchema[];
}

export interface PipelineStep {
  step: string;
  functionRef: { name: string };
  input?: Record<string, unknown>;
  requirements?: PipelineStepRequirements;
}

export function getServedSchema(jsonData: any): any {
  const versions: any[] = jsonData?.spec?.versions ?? [];
  const served = versions.find((v: any) => v.served !== false) ?? versions[0];
  return served?.schema?.openAPIV3Schema ?? null;
}

export function isKroStep(s: PipelineStep): boolean {
  return !!(
    s.functionRef?.name?.includes('kro') ||
    (s.input as any)?.kind === 'ResourceGraph'
  );
}
