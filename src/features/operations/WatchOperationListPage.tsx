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
import { WatchOperation } from '../../resources';

function WatchOperationNameLink({ item }: { item: any }) {
  const launch = () =>
    Activity.launch({
      id: `crossplane-watchoperation-${item.metadata.name}`,
      title: `WatchOperation ${item.metadata.name}`,
      hideTitleInHeader: true,
      location: 'split-right',
      cluster: item.cluster,
      content: <WatchOperationDetailInner name={item.metadata.name} />,
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

export function WatchOperationListPage() {
  const filterFunction = useFilterFunc();
  const [items] = WatchOperation.useList();

  return (
    <SectionBox title={<SectionFilterHeader title="Watch Operations" />}>
      <ResourceTable.default
        data={items}
        filterFunction={filterFunction}
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => <WatchOperationNameLink item={item} />,
          },
          {
            label: 'Watch Kind',
            getValue: (item: any) => item.jsonData?.spec?.watch?.kind ?? '-',
          },
          {
            label: 'Condition Type',
            getValue: (item: any) => item.jsonData?.spec?.watch?.conditionType ?? '-',
          },
          {
            label: 'Condition Status',
            getValue: (item: any) => item.jsonData?.spec?.watch?.conditionStatus ?? '-',
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

export function WatchOperationDetailInner({ name }: { name: string }) {
  const [item] = WatchOperation.useGet(name);

  const watch = item?.jsonData?.spec?.watch;
  const opTemplate = item?.jsonData?.spec?.operationTemplate?.spec;

  const extraInfo = item
    ? [
        {
          name: 'Watch Target',
          value: watch
            ? `${watch.apiVersion ?? ''}/${watch.kind ?? ''}`
            : '-',
        },
        { name: 'Condition Type', value: watch?.conditionType ?? '-' },
        { name: 'Condition Status', value: watch?.conditionStatus ?? '-' },
        { name: 'Operation', value: opTemplate?.operation ?? '-' },
        {
          name: 'Operation Target',
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

export function WatchOperationDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <WatchOperationDetailInner name={name} />;
}
