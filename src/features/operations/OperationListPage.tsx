import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  ConditionsTable,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Link as MuiLink } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { ReadyStatus, SyncedStatus } from '../../components/ConditionStatus';
import { Operation } from '../../resources';

function OperationNameLink({ item }: { item: any }) {
  const launch = () =>
    Activity.launch({
      id: `crossplane-operation-${item.metadata.name}`,
      title: `Operation ${item.metadata.name}`,
      hideTitleInHeader: true,
      location: 'split-right',
      cluster: item.cluster,
      content: <OperationDetailInner name={item.metadata.name} />,
    });
  return (
    <MuiLink
      component="button"
      onClick={launch}
      sx={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
    >
      {item.metadata.name}
    </MuiLink>
  );
}

export function OperationListPage() {
  const filterFunction = useFilterFunc();
  const [items] = Operation.useList();

  return (
    <SectionBox title={<SectionFilterHeader title="Operations" />}>
      <ResourceTable.default
        data={items}
        filterFunction={filterFunction}
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => <OperationNameLink item={item} />,
          },
          {
            label: 'Operation',
            getValue: (item: any) => item.jsonData?.spec?.operation ?? '-',
          },
          {
            label: 'Target Kind',
            getValue: (item: any) => item.jsonData?.spec?.target?.kind ?? '-',
          },
          {
            label: 'Target Name',
            getValue: (item: any) => item.jsonData?.spec?.target?.name ?? '-',
          },
          {
            label: 'Ready',
            getValue: (item: any) =>
              item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Ready')?.status ?? '-',
            render: (item: any) => <ReadyStatus item={item} />,
          },
          {
            label: 'Synced',
            getValue: (item: any) =>
              item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Synced')?.status ?? '-',
            render: (item: any) => <SyncedStatus item={item} />,
          },
          'age',
        ]}
      />
    </SectionBox>
  );
}

export function OperationDetailInner({ name }: { name: string }) {
  const [item] = Operation.useGet(name);

  const target = item?.jsonData?.spec?.target;
  const matchLabels = target?.matchLabels;

  const extraInfo = item
    ? [
        { name: 'Operation', value: item.jsonData?.spec?.operation ?? '-' },
        {
          name: 'Target',
          value: target
            ? `${target.group ?? ''}/${target.kind ?? ''} ${target.name ?? ''}`
            : '-',
        },
        {
          name: 'Match Labels',
          value: matchLabels
            ? Object.entries(matchLabels)
                .map(([k, v]) => `${k}=${v}`)
                .join(', ')
            : '-',
        },
      ]
    : [];

  return (
    <Box pb={9}>
      <MainInfoSection resource={item} extraInfo={extraInfo} />
      {item && <ConditionsTable resource={item} />}
    </Box>
  );
}

export function OperationDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <OperationDetailInner name={name} />;
}
