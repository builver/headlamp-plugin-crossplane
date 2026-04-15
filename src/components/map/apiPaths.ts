import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

export function getGroupVersion(apiVersion: string): [string, string] {
  const parts = apiVersion.split('/');
  return parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
}

export function lookupPlural(
  apiVersion: string,
  kind: string,
  crds: KubeObject[] | null,
): string | undefined {
  // K8s.ResourceClasses covers all native K8s resources (Deployment, Pod, Service, etc.)
  // Each class carries static apiVersion and apiName (plural) set by Headlamp.
  const builtin = Object.values(K8s.ResourceClasses).find(
    cls => cls.kind === kind && cls.apiVersion === apiVersion
  );
  if (builtin?.apiName) return builtin.apiName as string;

  // Fall back to CRD list for custom resources
  const [group] = getGroupVersion(apiVersion);
  return crds?.find(
    crd => crd.jsonData?.spec?.names?.kind === kind && crd.jsonData?.spec?.group === group
  )?.jsonData?.spec?.names?.plural as string | undefined;
}

export function buildGetPath(
  apiVersion: string,
  plural: string,
  name: string,
  namespace?: string,
): string {
  const [group, version] = getGroupVersion(apiVersion);
  const base = group ? `/apis/${group}/${version}` : `/api/${version}`;
  return namespace
    ? `${base}/namespaces/${namespace}/${plural}/${name}`
    : `${base}/${plural}/${name}`;
}

export function buildListPath(
  apiVersion: string,
  plural: string,
  namespace?: string,
): string {
  const [group, version] = getGroupVersion(apiVersion);
  const base = group ? `/apis/${group}/${version}` : `/api/${version}`;
  return namespace ? `${base}/namespaces/${namespace}/${plural}` : `${base}/${plural}`;
}
