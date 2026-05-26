import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { makeCustomResourceClass } from '@kinvolk/headlamp-plugin/lib/lib/k8s/crd';

// ── apiextensions.crossplane.io/v1alpha1 ─────────────────────────────────────

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

  static getBaseObject() {
    const base = super.getBaseObject();
    base.spec = { data: {} };
    return base;
  }
}

export class ManagedResourceActivationPolicy extends KubeObject {
  static kind = 'ManagedResourceActivationPolicy';
  static apiName = 'managedresourceactivationpolicies';
  static apiVersion = 'apiextensions.crossplane.io/v1alpha1';
  static isNamespaced = false;
}

/**
 * Creates a dynamic KubeObject class for the Managed Resources defined by an MRD.
 */
export function makeMRClass(mrd: KubeObject) {
  const spec = mrd.jsonData?.spec;
  const isNamespaced = spec?.scope === 'Namespaced';

  const versions: any[] = (spec?.versions ?? []).filter((v: any) => v.served !== false);
  const apiInfo =
    versions.length > 0
      ? versions.map((v: any) => ({ group: spec.group, version: v.name }))
      : [{ group: spec.group, version: 'v1' }];

  return makeCustomResourceClass({
    apiInfo,
    kind: spec.names.kind,
    pluralName: spec.names.plural,
    singularName: spec.names.singular ?? spec.names.kind.toLowerCase(),
    isNamespaced,
  });
}
