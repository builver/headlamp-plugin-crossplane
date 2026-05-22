import {
  ConditionsTable,
  Link,
  MainInfoSection,
  SectionBox,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { ManagedResourceDefinition } from '../../resources';

export function MRDDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [mrds] = ManagedResourceDefinition.useList();

  const mrd = mrds?.find(m => m.metadata.name === name) ?? null;
  const scope = mrd?.jsonData?.spec?.scope ?? null;

  const extraInfo = mrd
    ? [
        { name: 'Group', value: mrd.jsonData?.spec?.group ?? '-' },
        { name: 'Kind', value: mrd.jsonData?.spec?.names?.kind ?? '-' },
        { name: 'Plural', value: mrd.jsonData?.spec?.names?.plural ?? '-' },
        { name: 'Scope', value: scope ?? '-' },
        { name: 'State', value: mrd.jsonData?.spec?.state ?? '-' },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={mrd} extraInfo={extraInfo} />
      {mrd && <ConditionsTable resource={mrd.jsonData} />}
    </>
  );
}

export function MRDListPage() {
  const [mrds] = ManagedResourceDefinition.useList();
  const providerNames: string[] = useMemo(() => {
    if (!mrds) return [];
    const names = new Set<string>();
    for (const mrd of mrds) {
      const name = mrd.metadata?.ownerReferences?.find((r: any) => r.kind === 'Provider')?.name;
      if (name) names.add(name);
    }
    return [...names].sort();
  }, [mrds]);

  return (
    <SectionBox title="Managed Resources">
      <Table
        data={mrds}
        loading={mrds === null}
        initialState={{ showColumnFilters: true }}
        columns={[
          {
            header: 'Resource',
            accessorFn: (item: any) => item.jsonData?.spec?.names?.kind ?? '-',
            Cell: ({ row: { original: item } }: any) => {
              const isActivated =
                item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Established')
                  ?.status === 'True';
              const label = item.jsonData?.spec?.names?.kind ?? item.metadata.name;
              return isActivated ? (
                <Link routeName="crossplane-mr-list" params={{ mrdName: item.metadata.name }}>
                  {label}
                </Link>
              ) : (
                label
              );
            },
          },
          {
            header: 'Definition',
            accessorFn: (item: any) => item.metadata.name,
            Cell: ({ row: { original: item } }: any) => (
              <Link routeName={`crossplane-mrd-detail-${item.metadata.name}`}>
                {item.metadata.name}
              </Link>
            ),
          },
          {
            header: 'Group',
            accessorFn: (item: any) => item.jsonData?.spec?.group ?? '-',
          },
          {
            header: 'Provider',
            accessorFn: (item: any) =>
              item.metadata?.ownerReferences?.find((r: any) => r.kind === 'Provider')?.name ?? '-',
            filterVariant: 'select',
            filterSelectOptions: providerNames,
            Cell: ({ row: { original: item } }: any) => {
              const providerName = item.metadata?.ownerReferences?.find(
                (r: any) => r.kind === 'Provider'
              )?.name;
              return providerName ? (
                <Link routeName={`crossplane-provider-detail-${providerName}`}>
                  {providerName}
                </Link>
              ) : (
                '-'
              );
            },
          },
          {
            header: 'Scope',
            accessorFn: (item: any) => item.jsonData?.spec?.scope ?? 'Cluster',
            filterVariant: 'select',
            filterSelectOptions: ['Cluster', 'Namespaced'],
          },
          {
            header: 'Activated',
            accessorFn: (item: any) => {
              const established = item.jsonData?.status?.conditions?.find(
                (c: any) => c.type === 'Established'
              );
              return established?.status === 'True' ? 'Yes' : 'No';
            },
            filterVariant: 'select',
            filterSelectOptions: ['Yes', 'No'],
          },
        ]}
      />
    </SectionBox>
  );
}
