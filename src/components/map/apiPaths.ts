import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { NATIVE_PLURALS } from './constants';

export function getGroupVersion(apiVersion: string): [string, string] {
  const parts = apiVersion.split('/');
  return parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
}

export function lookupPlural(
  apiVersion: string,
  kind: string,
  crds: KubeObject[] | null,
): string | undefined {
  const [group] = getGroupVersion(apiVersion);
  const key = `${group}/${kind}`;
  if (NATIVE_PLURALS[key]) return NATIVE_PLURALS[key];
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
