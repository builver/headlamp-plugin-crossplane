import { makeCustomResourceClass } from '@kinvolk/headlamp-plugin/lib/lib/k8s/crd';

export interface ConfigCRDInfo {
  crdName: string;
  group: string;
  kind: string;
  plural: string;
  versions: Array<{ group: string; version: string }>;
  isNamespaced: boolean;
}

/** Stub class so useList/useGet can be called unconditionally before the real CRD resolves. */
export const STUB_CLASS = makeCustomResourceClass({
  apiInfo: [{ group: 'stub.crossplane.io', version: 'v1' }],
  kind: 'Stub',
  pluralName: 'stubs',
  singularName: 'stub',
  isNamespaced: false,
});

/** Module-level cache: crdName → class. Guarantees the same class instance across renders. */
const classCache = new Map<string, ReturnType<typeof makeCustomResourceClass>>();

export function getOrCreateClass(info: ConfigCRDInfo) {
  let cls = classCache.get(info.crdName);
  if (!cls) {
    cls = makeCustomResourceClass({
      apiInfo: info.versions,
      kind: info.kind,
      pluralName: info.plural,
      singularName: info.kind.toLowerCase(),
      isNamespaced: info.isNamespaced,
    });
    classCache.set(info.crdName, cls);
  }
  return cls;
}
