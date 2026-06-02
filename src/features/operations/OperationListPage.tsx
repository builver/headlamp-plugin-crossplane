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
import { readyColumn, syncedColumn } from '../../components/columns';
import { useNameFromRoute } from '../../components/hooks';
import { Operation } from '../../resources';

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
            render: (item: any) => (
              <ActivityNameLink
                item={item}
                kindLabel="Operation"
                content={<OperationDetailInner name={item.metadata.name} />}
              />
            ),
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
          readyColumn,
          syncedColumn,
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
      <MainInfoSection resource={item} extraInfo={extraInfo} backLink={null} />
      {item && <ConditionsTable resource={item} />}
    </Box>
  );
}

export function OperationDetailPage() {
  const name = useNameFromRoute();
  return <OperationDetailInner name={name} />;
}
