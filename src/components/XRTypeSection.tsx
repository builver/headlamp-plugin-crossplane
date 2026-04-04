import { Link, ResourceTable } from '@kinvolk/headlamp-plugin/lib/components/common';
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
      label: 'Name',
      getValue: (item: KubeObject) => item.metadata.name,
      render: (item: KubeObject) => {
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
    ...(isNamespaced ? ['namespace' as const] : []),
    {
      label: 'Composition',
      getValue: (item: KubeObject) => getCompositionRef(item, scope),
    },
    {
      label: 'Ready',
      getValue: (item: KubeObject) => item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Ready')?.status ?? '-',
      render: (item: KubeObject) => <ReadyStatus item={item} />,
    },
    {
      label: 'Synced',
      getValue: (item: KubeObject) => item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Synced')?.status ?? '-',
      render: (item: KubeObject) => <SyncedStatus item={item} />,
    },
    'age' as const,
  ];

  return (
    <ResourceTable.default
      data={items}
      filterFunction={filterFunction}
      enableRowActions
      columns={columns}
    />
  );
}
