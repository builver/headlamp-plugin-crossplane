import {
  ConditionsTable,
  DateLabel,
  Link,
  MainInfoSection,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ReadyStatus } from '../components/ConditionStatus';
import { XRTypeSection } from '../components/XRTypeSection';
import {
  CompositeResourceDefinition,
  getXRScope,
  makeClaimClass,
} from '../resources';

export function XRDListPage() {
  const filterFunction = useFilterFunc();
  const [xrds, error] = CompositeResourceDefinition.useList();

  if (error?.status === 404) {
    return (
      <SectionBox title="XRDs">
        <p>CompositeResourceDefinitions not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox title={<SectionFilterHeader title="Composite Resource Definitions" />}>
      <Table
        data={xrds}
        loading={xrds === null}
        filterFunction={filterFunction}
        columns={[
          {
            header: 'Name',
            accessorKey: 'metadata.name',
            Cell: ({ row: { original: item } }) => (
              <Link routeName="crossplane-xrd-detail" params={{ name: item.metadata.name }}>
                {item.metadata.name}
              </Link>
            ),
          },
          {
            header: 'Scope',
            accessorFn: item => getXRScope(item),
          },
          {
            header: 'Established',
            accessorFn: item => {
              const cond = item.jsonData?.status?.conditions?.find(c => c.type === 'Established');
              return cond?.status ?? '-';
            },
          },
          {
            header: 'Offered',
            accessorFn: item => {
              const cond = item.jsonData?.status?.conditions?.find(c => c.type === 'Offered');
              return cond?.status ?? '-';
            },
          },
          {
            header: 'Group',
            accessorFn: item => item.jsonData?.spec?.group ?? '-',
          },
          {
            header: 'Age',
            accessorFn: item => -new Date(item.metadata.creationTimestamp).getTime(),
            Cell: ({ row: { original: item } }) => (
              <DateLabel date={item.metadata.creationTimestamp} format="mini" />
            ),
          },
        ]}
      />
    </SectionBox>
  );
}

export function XRDDetailPage() {
  const { name } = useParams<{ name: string }>();
  const [xrd] = CompositeResourceDefinition.useGet(name);

  const scope = xrd ? getXRScope(xrd) : null;
  const hasClaimNames = !!xrd?.jsonData?.spec?.claimNames?.kind;

  const extraInfo = xrd
    ? [
        { name: 'Status', value: <ReadyStatus item={xrd} /> },
        { name: 'Scope', value: scope },
        { name: 'Group', value: xrd.jsonData?.spec?.group ?? '-' },
        {
          name: 'Kind',
          value: xrd.jsonData?.spec?.names?.kind ?? '-',
        },
        ...(hasClaimNames
          ? [{ name: 'Claim Kind', value: xrd.jsonData?.spec?.claimNames?.kind }]
          : []),
        {
          name: 'Default Composition',
          value: xrd.jsonData?.spec?.defaultCompositionRef?.name ?? '-',
        },
        {
          name: 'Composition Update Policy',
          value: xrd.jsonData?.spec?.compositionUpdatePolicy ?? '-',
        },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={xrd} extraInfo={extraInfo} />
      {xrd && (
        <>
          <SectionBox title="Composite Resources">
            <XRTypeSection xrd={xrd} scope={scope!} />
          </SectionBox>
          {hasClaimNames && (
            <SectionBox title="Claims">
              <ClaimTypeInlineSection xrd={xrd} />
            </SectionBox>
          )}
          <ConditionsTable resource={xrd.jsonData} />
        </>
      )}
    </>
  );
}

// Inline claims section shown only when XRD has claimNames (LegacyCluster)
function ClaimTypeInlineSection({ xrd }: { xrd: any }) {
  const filterFunction = useFilterFunc();
  // Rendered only when XRD has claimNames, so makeClaimClass is non-null here
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const ClaimClass = useMemo(() => makeClaimClass(xrd)!, [xrd.metadata.uid]);
  const [items] = ClaimClass.useList();

  if (!items?.length) return <p>No claims found.</p>;

  return (
    <Table
      data={items}
      loading={items === null}
      filterFunction={filterFunction}
      columns={[
        { header: 'Name', accessorKey: 'metadata.name' },
        { header: 'Namespace', accessorKey: 'metadata.namespace' },
        {
          header: 'XR Ref',
          accessorFn: (item: any) => item.jsonData?.spec?.resourceRef?.name ?? '-',
        },
        {
          header: 'Age',
          accessorFn: (item: any) => -new Date(item.metadata.creationTimestamp).getTime(),
          Cell: ({ row: { original: item } }: any) => (
            <DateLabel date={item.metadata.creationTimestamp} format="mini" />
          ),
        },
      ]}
    />
  );
}
