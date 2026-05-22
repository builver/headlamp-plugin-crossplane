import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  ConditionsTable,
  CreateResourceButton,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Link as MuiLink } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { packageResourceColumns } from '../../components/columns';
import { HealthyStatus, InstalledStatus } from '../../components/ConditionStatus';
import { Provider } from '../../resources';

function ProviderNameLink({ item }: { item: any }) {
  const launch = () => Activity.launch({
    id: `crossplane-provider-${item.metadata.name}`,
    title: `Provider ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: <Icon icon="mdi:puzzle-outline" width="100%" height="100%" />,
    content: <ProviderDetailInner name={item.metadata.name} />,
  });
  return (
    <MuiLink component="button" onClick={launch}
      sx={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
    >
      {item.metadata.name}
    </MuiLink>
  );
}

export function ProviderListPage() {
  const filterFunction = useFilterFunc();
  const [providers, error] = Provider.useList();

  if (error?.status === 404) {
    return (
      <SectionBox title="Providers">
        <p>Providers not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Providers"
          titleSideActions={[<CreateResourceButton resourceClass={Provider} resourceName="Provider" />]}
        />
      }
    >
      <ResourceTable.default
        data={providers}
        filterFunction={filterFunction}
        enableRowActions
        columns={[
          {
            label: 'Name',
            getValue: item => item.metadata.name,
            render: item => <ProviderNameLink item={item} />,
          },
          ...packageResourceColumns,
        ]}
      />
    </SectionBox>
  );
}

export function ProviderDetailInner({ name }: { name: string }) {
  const [provider] = Provider.useGet(name);

  const extraInfo = provider
    ? [
        { name: 'Installed', value: <InstalledStatus item={provider} /> },
        { name: 'Healthy', value: <HealthyStatus item={provider} /> },
        { name: 'Package', value: provider.jsonData?.spec?.package ?? '-' },
        { name: 'Pull Policy', value: provider.jsonData?.spec?.packagePullPolicy ?? '-' },
        {
          name: 'Revision Activation Policy',
          value: provider.jsonData?.spec?.revisionActivationPolicy ?? '-',
        },
        { name: 'Current Revision', value: provider.jsonData?.status?.currentRevision ?? '-' },
      ]
    : [];

  return (
    <Box pb={9}>
      <MainInfoSection resource={provider} extraInfo={extraInfo} />
      {provider && <ConditionsTable resource={provider.jsonData} />}
    </Box>
  );
}

export function ProviderDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <ProviderDetailInner name={name} />;
}
