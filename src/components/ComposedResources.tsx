import { ApiProxy, K8s } from '@kinvolk/headlamp-plugin/lib';
import { DateLabel, Link, Table } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useEffect, useRef, useState } from 'react';
import { ReadyStatus, SyncedStatus } from './ConditionStatus';
import { XRScope } from '../resources';

interface ResourceRef {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
}

function getGroupVersion(apiVersion: string): [string, string] {
  const parts = apiVersion.split('/');
  return parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
}

function lookupPlural(apiVersion: string, kind: string, crds: KubeObject[]): string | undefined {
  const [group] = getGroupVersion(apiVersion);
  return crds.find(
    crd => crd.jsonData?.spec?.names?.kind === kind && crd.jsonData?.spec?.group === group
  )?.jsonData?.spec?.names?.plural as string | undefined;
}

interface ComposedResourcesProps {
  item: KubeObject;
  scope: XRScope;
}

/**
 * Displays a table of composed resources for a given XR.
 *
 * Reads resourceRefs from the XR spec (v1: spec.resourceRefs,
 * v2: spec.crossplane.resourceRefs), looks up their plural names via CRD
 * list, fetches each resource, and renders name, kind, Ready, Synced, and age.
 */
export function ComposedResources({ item, scope }: ComposedResourcesProps) {
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList() as [KubeObject[] | null, any];
  const [resources, setResources] = useState<any[]>([]);

  // Stable key so the effect only fires when the actual ref list changes,
  // not on every watch-triggered re-render of crds.
  const refs: ResourceRef[] =
    scope === 'LegacyCluster'
      ? (item.jsonData?.spec?.resourceRefs ?? [])
      : (item.jsonData?.spec?.crossplane?.resourceRefs ?? []);
  const refsKey = refs.map(r => `${r.apiVersion}/${r.kind}/${r.name}`).join('|');

  // Track which (refsKey, crds) combination we've already fetched so that
  // rapid crds watch updates don't re-fire the fetch unnecessarily.
  const fetchedFor = useRef('');

  useEffect(() => {
    if (!crds || refs.length === 0) return;

    const fetchKey = `${refsKey}::${crds.length}`;
    if (fetchedFor.current === fetchKey) return;
    fetchedFor.current = fetchKey;

    const xrNamespace = item.metadata.namespace;

    Promise.allSettled(
      refs.map(async ref => {
        // For Namespaced-scope XRs the ref.namespace field is often unset;
        // composed resources inherit the XR's own namespace in that case.
        const resolvedNs =
          scope === 'Namespaced' ? (ref.namespace ?? xrNamespace) : ref.namespace;

        const plural = lookupPlural(ref.apiVersion, ref.kind, crds);
        const [group, version] = getGroupVersion(ref.apiVersion);
        const base = group ? `/apis/${group}/${version}` : `/api/${version}`;

        if (!plural) {
          // CRD not found — return skeleton row from the ref itself so the
          // table still shows something rather than silently dropping the row.
          return {
            apiVersion: ref.apiVersion,
            kind: ref.kind,
            metadata: { name: ref.name, namespace: resolvedNs },
            _plural: undefined,
          };
        }

        const path = resolvedNs
          ? `${base}/namespaces/${resolvedNs}/${plural}/${ref.name}`
          : `${base}/${plural}/${ref.name}`;

        try {
          const raw = await ApiProxy.request(path);
          return { ...raw, _plural: plural };
        } catch {
          return {
            apiVersion: ref.apiVersion,
            kind: ref.kind,
            metadata: { name: ref.name, namespace: resolvedNs },
            _plural: plural,
          };
        }
      })
    ).then(results => {
      setResources(results.flatMap(r => (r.status === 'fulfilled' ? [r.value] : [])));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey, crds]);

  return (
    <Table
      data={resources}
      columns={[
        {
          header: 'Name',
          accessorKey: 'metadata.name',
          Cell: ({ row: { original: r } }: any) => {
            if (!r._plural) return r.metadata.name;
            const [group] = getGroupVersion(r.apiVersion ?? '');
            const crdFullName = group ? `${r._plural}.${group}` : r._plural;
            return (
              <Link
                routeName="customresource"
                params={{
                  crName: r.metadata.name,
                  crd: crdFullName,
                  namespace: r.metadata.namespace || '-',
                }}
              >
                {r.metadata.name}
              </Link>
            );
          },
        },
        {
          header: 'Namespace',
          accessorFn: (r: any) => r.metadata?.namespace ?? '',
          Cell: ({ cell }: any) =>
            cell.getValue() ? (
              <Link routeName="namespace" params={{ name: cell.getValue() }}>
                {cell.getValue()}
              </Link>
            ) : null,
        },
        {
          header: 'Kind',
          accessorFn: (r: any) => r.kind ?? '',
        },
        {
          header: 'Ready',
          accessorFn: (r: any) => r,
          Cell: ({ row: { original: r } }: any) => (
            <ReadyStatus item={{ jsonData: r } as unknown as KubeObject} />
          ),
        },
        {
          header: 'Synced',
          accessorFn: (r: any) => r,
          Cell: ({ row: { original: r } }: any) => (
            <SyncedStatus item={{ jsonData: r } as unknown as KubeObject} />
          ),
        },
        {
          header: 'Age',
          accessorFn: (r: any) => -new Date(r.metadata?.creationTimestamp).getTime(),
          Cell: ({ row: { original: r } }: any) =>
            r.metadata?.creationTimestamp ? (
              <DateLabel date={r.metadata.creationTimestamp} format="mini" />
            ) : null,
        },
      ]}
    />
  );
}
