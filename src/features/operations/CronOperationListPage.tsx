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
import { CronOperation } from '../../resources';

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
            render: (item: any) => (
              <ActivityNameLink
                item={item}
                kindLabel="CronOperation"
                content={<CronOperationDetailInner name={item.metadata.name} />}
              />
            ),
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
          readyColumn,
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
  const name = useNameFromRoute();
  return <CronOperationDetailInner name={name} />;
}
