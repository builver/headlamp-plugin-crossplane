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
import { ReadyStatus } from '../../components/ConditionStatus';
import { CronOperation } from '../../resources';

function CronOperationNameLink({ item }: { item: any }) {
  const launch = () =>
    Activity.launch({
      id: `crossplane-cronoperation-${item.metadata.name}`,
      title: `CronOperation ${item.metadata.name}`,
      hideTitleInHeader: true,
      location: 'split-right',
      cluster: item.cluster,
      content: <CronOperationDetailInner name={item.metadata.name} />,
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

export function CronOperationListPage() {
  const filterFunction = useFilterFunc();
  const [items] = CronOperation.useList();

  return (
    <SectionBox title={<SectionFilterHeader title="Cron Operations" />}>
      <ResourceTable.default
        data={items}
        filterFunction={filterFunction}
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => <CronOperationNameLink item={item} />,
          },
          {
            label: 'Schedule',
            getValue: (item: any) => item.jsonData?.spec?.schedule ?? '-',
          },
          {
            label: 'Target Kind',
            getValue: (item: any) =>
              item.jsonData?.spec?.operationTemplate?.spec?.target?.kind ?? '-',
          },
          {
            label: 'Operation',
            getValue: (item: any) =>
              item.jsonData?.spec?.operationTemplate?.spec?.operation ?? '-',
          },
          {
            label: 'Ready',
            getValue: (item: any) =>
              item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Ready')?.status ?? '-',
            render: (item: any) => <ReadyStatus item={item} />,
          },
          'age',
        ]}
      />
    </SectionBox>
  );
}

export function CronOperationDetailInner({ name }: { name: string }) {
  const [item] = CronOperation.useGet(name);

  const opTemplate = item?.jsonData?.spec?.operationTemplate?.spec;

  const extraInfo = item
    ? [
        { name: 'Schedule', value: item.jsonData?.spec?.schedule ?? '-' },
        { name: 'Suspend', value: item.jsonData?.spec?.suspend ? 'Yes' : 'No' },
        { name: 'Operation', value: opTemplate?.operation ?? '-' },
        {
          name: 'Target',
          value: opTemplate?.target
            ? `${opTemplate.target.group ?? ''}/${opTemplate.target.kind ?? ''} ${opTemplate.target.name ?? ''}`
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

export function CronOperationDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <CronOperationDetailInner name={name} />;
}
