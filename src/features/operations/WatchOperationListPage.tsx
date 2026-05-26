import {
  ConditionsTable,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box } from '@mui/material';
import { ActivityNameLink } from '../../components/ActivityNameLink';
import { readyColumn } from '../../components/columns';
import { useNameFromRoute } from '../../components/hooks';
import { WatchOperation } from '../../resources';

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
            render: (item: any) => (
              <ActivityNameLink
                item={item}
                kindLabel="WatchOperation"
                content={<WatchOperationDetailInner name={item.metadata.name} />}
              />
            ),
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
          readyColumn,
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
  const name = useNameFromRoute();
  return <WatchOperationDetailInner name={name} />;
}
