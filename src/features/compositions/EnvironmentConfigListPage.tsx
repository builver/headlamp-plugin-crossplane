import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  DataField,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Link as MuiLink } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { stringify as yamlStringify } from 'yaml';
import { EnvironmentConfig } from '../../resources';

function EnvironmentConfigNameLink({ item }: { item: any }) {
  const launch = () =>
    Activity.launch({
      id: `crossplane-envconfig-${item.metadata.name}`,
      title: `EnvironmentConfig ${item.metadata.name}`,
      hideTitleInHeader: true,
      location: 'split-right',
      cluster: item.cluster,
      content: <EnvironmentConfigDetailInner name={item.metadata.name} />,
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
            render: (item: any) => <EnvironmentConfigNameLink item={item} />,
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
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <EnvironmentConfigDetailInner name={name} />;
}
