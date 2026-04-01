import { DateLabel, Link, Table } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useMemo } from 'react';
import { getCompositionRef, makeXRClass, XRScope } from '../resources';
import { ReadyStatus, SyncedStatus } from './ConditionStatus';

interface XRTypeSectionProps {
  xrd: KubeObject;
  scope: XRScope;
}

/**
 * Renders a table of Composite Resources for a single XRD type.
 * Each instance of this component makes exactly one useList() call,
 * which satisfies React's rules of hooks (no hooks in loops).
 */
export function XRTypeSection({ xrd, scope }: XRTypeSectionProps) {
  const filterFunction = useFilterFunc();
  const spec = xrd.jsonData?.spec;
  const plural = spec?.names?.plural ?? '';

  const DynClass = useMemo(() => makeXRClass(xrd), [xrd.metadata.uid]);
  const [items] = DynClass.useList();

  if (!items?.length) return null;

  const isNamespaced = scope === 'Namespaced';
  const detailRoute = isNamespaced
    ? 'crossplane-xr-detail-namespaced'
    : 'crossplane-xr-detail-cluster';

  const columns = [
    {
      header: 'Name',
      accessorKey: 'metadata.name',
      Cell: ({ row: { original: item } }: any) => {
        const params = isNamespaced
          ? { plural, namespace: item.metadata.namespace, name: item.metadata.name }
          : { plural, name: item.metadata.name };
        return (
          <Link routeName={detailRoute} params={params}>
            {item.metadata.name}
          </Link>
        );
      },
    },
    ...(isNamespaced
      ? [
          {
            header: 'Namespace',
            accessorKey: 'metadata.namespace',
          },
        ]
      : []),
    {
      header: 'Composition',
      accessorFn: (item: KubeObject) => getCompositionRef(item, scope),
    },
    {
      header: 'Ready',
      accessorFn: (item: KubeObject) => item,
      Cell: ({ row: { original: item } }: any) => <ReadyStatus item={item} />,
    },
    {
      header: 'Synced',
      accessorFn: (item: KubeObject) => item,
      Cell: ({ row: { original: item } }: any) => <SyncedStatus item={item} />,
    },
    {
      header: 'Age',
      accessorFn: (item: KubeObject) => -new Date(item.metadata.creationTimestamp).getTime(),
      Cell: ({ row: { original: item } }: any) => (
        <DateLabel date={item.metadata.creationTimestamp} format="mini" />
      ),
    },
  ];

  return (
    <Table
      data={items}
      loading={items === null}
      filterFunction={filterFunction}
      columns={columns}
    />
  );
}
