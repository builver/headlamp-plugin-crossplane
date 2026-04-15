import { Icon } from '@iconify/react';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { getGroupVersion } from './apiPaths';
import { XRMapDetail } from './detailComponents';

// Sentinel returned by _class() on all stubs — must not match any real class.
const NO_CLASS = { apiGroupName: '__stub__', apiName: '__stub__', kind: '__stub__' };

/**
 * Minimal KubeObject-like stub for non-XR child nodes (native K8s + CRDs).
 * KubeObjectDetails only needs kind/metadata/cluster to route to the right
 * detail component, which then re-fetches the resource itself.
 */
export function makeKubeObjectLike(
  apiVersion: string,
  kind: string,
  name: string,
  namespace?: string,
): any {
  return {
    kind,
    apiVersion,
    metadata: { name, namespace },
    cluster: undefined,
    _class: () => NO_CLASS,
    getName: () => name,
    getNamespace: () => namespace,
  };
}

/**
 * Rich KubeObject-like wrapper built from already-fetched raw JSON.
 * Used for sub-XR nodes so XRMapDetail can read conditions, resourceRefs, etc.
 */
export function makeXRKubeObjectFromJson(rawJson: any): any {
  const name: string = rawJson?.metadata?.name ?? '';
  const namespace: string | undefined = rawJson?.metadata?.namespace;
  return {
    kind: rawJson?.kind,
    apiVersion: rawJson?.apiVersion,
    metadata: rawJson?.metadata ?? { name, namespace },
    jsonData: rawJson,
    cluster: undefined,
    _class: () => NO_CLASS,
    getName: () => name,
    getNamespace: () => namespace,
  };
}

export function findCrdName(
  apiVersion: string,
  kind: string,
  crds: KubeObject[] | null,
): string | undefined {
  if (!crds) return undefined;
  const [group] = getGroupVersion(apiVersion);
  const crd = crds.find(
    c => c.jsonData?.spec?.names?.kind === kind && c.jsonData?.spec?.group === group
  );
  // KubeObjectDetails passes this value as the `crd` prop to CustomResourceDetails,
  // which treats it as a CRD name string passed to CustomResourceDefinition.useGet().
  return crd?.metadata?.name as string | undefined;
}

export function makeChildNode(
  id: string,
  apiVersion: string,
  kind: string,
  name: string,
  namespace: string | undefined,
  crds: KubeObject[] | null,
  icon = 'mdi:cube-outline',
  detailsComponent?: (props: { node: any }) => JSX.Element | null,
): object {
  const crdName = findCrdName(apiVersion, kind, crds);
  const node: any = {
    id,
    label: name,
    subtitle: namespace ? `${kind} · ${namespace}` : kind,
    icon: <Icon icon={icon} width="100%" height="100%" />,
    kubeObject: makeKubeObjectLike(apiVersion, kind, name, namespace),
  };
  if (crdName) node.customResourceDefinition = crdName;
  if (detailsComponent) node.detailsComponent = detailsComponent;
  return node;
}

/** Node factory for child XR nodes — uses fetched rawJson so XRMapDetail works. */
export function makeSubXRNode(
  id: string,
  apiVersion: string,
  kind: string,
  name: string,
  namespace: string | undefined,
  rawJson: any,
): object {
  return {
    id,
    label: name,
    subtitle: namespace ? `${kind} · ${namespace}` : kind,
    icon: <Icon icon="mdi:layers-outline" width="100%" height="100%" />,
    kubeObject: makeXRKubeObjectFromJson(rawJson),
    weight: 1000,
    detailsComponent: XRMapDetail,
  };
}
