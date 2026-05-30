import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { makeCustomResourceClass } from '@kinvolk/headlamp-plugin/lib/lib/k8s/crd';
import type { Condition, XRScope } from './helpers';
import { getXRScope } from './helpers';

export type { Condition, XRScope };
export {
  getCompositionRef,
  getHealthyCondition,
  getInstalledCondition,
  getReadyCondition,
  getResponsiveCondition,
  getRevisionHealthyCondition,
  getRuntimeHealthyCondition,
  getServedSchema,
  getSyncedCondition,
  getXRScope,
  isKroStep,
} from './helpers';
export type { PipelineStep, PipelineStepRequirements, RequiredResource, RequiredSchema } from './helpers';
export { useMrdSchemaMap } from './hooks';

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

  static getBaseObject() {
    const base = super.getBaseObject();
    base.spec = {
      compositeTypeRef: {
        apiVersion: '',
        kind: '',
      },
      mode: 'Pipeline',
      pipeline: [
        {
          step: 'render',
          functionRef: { name: '' },
        },
      ],
    };
    return base;
  }
}

export class CompositionRevision extends KubeObject {
  static kind = 'CompositionRevision';
  static apiName = 'compositionrevisions';
  static apiVersion = 'apiextensions.crossplane.io/v1';
  static isNamespaced = false;
}

// ── XR / Claim dynamic class helpers ─────────────────────────────────────────

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

