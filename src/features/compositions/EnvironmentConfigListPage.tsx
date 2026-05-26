import {
  DataField,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box } from '@mui/material';
import { stringify as yamlStringify } from 'yaml';
import { ActivityNameLink } from '../../components/ActivityNameLink';
import { useNameFromRoute } from '../../components/hooks';
import { EnvironmentConfig } from '../../resources';

export function EnvironmentConfigListPage() {
  const filterFunction = useFilterFunc();
  const [items, error] = EnvironmentConfig.useList();

  if (error?.status === 404) {
    return (
      <SectionBox title="Environment Configs">
        <p>EnvironmentConfigs not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox title={<SectionFilterHeader title="Environment Configs" />}>
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
                kindLabel="EnvironmentConfig"
                content={<EnvironmentConfigDetailInner name={item.metadata.name} />}
              />
            ),
          },
          {
            label: 'Data Keys',
            getValue: (item: any) => {
              const data = item.jsonData?.spec?.data;
              return data ? Object.keys(data).length.toString() : '0';
            },
          },
          'age',
        ]}
      />
    </SectionBox>
  );
}

export function EnvironmentConfigDetailInner({ name }: { name: string }) {
  const [item] = EnvironmentConfig.useGet(name);

  const data = item?.jsonData?.spec?.data;
  const dataKeys = data ? Object.keys(data) : [];
  const dataYaml = data ? yamlStringify(data, { blockQuote: true }) : '';

  const extraInfo = item
    ? [{ name: 'Data Keys', value: dataKeys.length.toString() }]
    : [];

  return (
    <Box pb={9}>
      <MainInfoSection resource={item} extraInfo={extraInfo} />
      {dataYaml && (
        <Box mt={2}>
          <DataField label="data.yaml" disableLabel value={dataYaml} onChange={() => {}} />
        </Box>
      )}
    </Box>
  );
}

export function EnvironmentConfigDetailPage() {
  const name = useNameFromRoute();
  return <EnvironmentConfigDetailInner name={name} />;
}
