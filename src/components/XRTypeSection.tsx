import { Link, ResourceTable } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useMemo } from 'react';
import { getCompositionRef, makeXRClass, XRScope } from '../resources';
import { makeXRNameColumn, readyColumn, syncedColumn } from './columns';

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

  const columns = [
    makeXRNameColumn(plural, scope),
    ...(isNamespaced ? ['namespace' as const] : []),
    {
      label: 'Composition',
      getValue: (item: KubeObject) => getCompositionRef(item, scope),
      render: (item: KubeObject) => {
        const name = getCompositionRef(item, scope);
        return name !== '-'
          ? <Link routeName={`crossplane-composition-detail-${name}`}>{name}</Link>
          : <span>-</span>;
      },
    },
    readyColumn,
    syncedColumn,
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
