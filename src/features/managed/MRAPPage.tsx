import {
  ActionButton,
  ConditionsTable,
  Link,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { HealthyStatus } from '../../components/ConditionStatus';
import { ManagedResourceActivationPolicy, ManagedResourceDefinition } from '../../resources';
import { MRAPCreateDialog } from './MRAPCreateDialog';

export function MRAPListPage() {
  const [mraps] = ManagedResourceActivationPolicy.useList();
  const [dialogOpen, setDialogOpen] = useState(false);
  const filterFunction = useFilterFunc();

  return (
    <>
    <MRAPCreateDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    <SectionBox
      title={
        <SectionFilterHeader
          title="Activation Policies"
          titleSideActions={[
            <ActionButton
              description="Create Activation Policy"
              icon="mdi:plus-circle"
              onClick={() => setDialogOpen(true)}
            />,
          ]}
        />
      }
    >
      <ResourceTable.default
        data={mraps}
        filterFunction={filterFunction}
        enableRowActions
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => (
              <Link routeName={`crossplane-mrap-detail-${item.metadata.name}`}>
                {item.metadata.name}
              </Link>
            ),
          },
          {
            label: 'Patterns',
            getValue: (item: any) => {
              const patterns: string[] = item.jsonData?.spec?.activate ?? [];
              return patterns.join('\n') || '-';
            },
            render: (item: any) => {
              const patterns: string[] = item.jsonData?.spec?.activate ?? [];
              if (patterns.length === 0) return <span>-</span>;
              return (
                <div>
                  {patterns.map((p: string) => (
                    <div key={p}>{p}</div>
                  ))}
                </div>
              );
            },
          },
          {
            label: 'Activated',
            getValue: (item: any) => item.jsonData?.status?.activated?.length ?? 0,
          },
          {
            label: 'Healthy',
            getValue: (item: any) =>
              item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Healthy')?.status ??
              '-',
            render: (item: any) => <HealthyStatus item={item} />,
          },
          'age',
        ]}
      />
    </SectionBox>
    </>
  );
}

export function MRAPDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [mraps] = ManagedResourceActivationPolicy.useList();
  const [mrds] = ManagedResourceDefinition.useList();

  const mrap = mraps?.find(m => m.metadata.name === name) ?? null;
  const patterns: string[] = mrap?.jsonData?.spec?.activate ?? [];
  const activatedNames: string[] = mrap?.jsonData?.status?.activated ?? [];

  const activatedMRDs = mrds?.filter(mrd => activatedNames.includes(mrd.metadata.name)) ?? [];

  const extraInfo = mrap
    ? [
        {
          name: 'Activate Patterns',
          value:
            patterns.length > 0 ? (
              <div>
                {patterns.map(p => (
                  <div key={p}>{p}</div>
                ))}
              </div>
            ) : (
              '-'
            ),
        },
        {
          name: 'Activated Count',
          value: activatedNames.length,
        },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={mrap} extraInfo={extraInfo} />
      {mrap && <ConditionsTable resource={mrap.jsonData} />}
      <SectionBox title="Activated Managed Resources">
        <Table
          data={activatedMRDs}
          loading={mrds === null}
          columns={[
            {
              header: 'Name',
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
              header: 'Kind',
              accessorFn: (item: any) => item.jsonData?.spec?.names?.kind ?? '-',
            },
          ]}
        />
      </SectionBox>
    </>
  );
}
