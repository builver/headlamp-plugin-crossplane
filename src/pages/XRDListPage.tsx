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
import { useParams } from 'react-router-dom';
import { ReadyStatus } from '../components/ConditionStatus';
import { CompositeResourceDefinition } from '../resources';

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

  const extraInfo = xrd
    ? [
        { name: 'Status', value: <ReadyStatus item={xrd} /> },
        { name: 'Group', value: xrd.jsonData?.spec?.group ?? '-' },
        { name: 'Claim Kind', value: xrd.jsonData?.spec?.claimNames?.kind ?? '-' },
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
      {xrd && <ConditionsTable resource={xrd.jsonData} />}
    </>
  );
}
