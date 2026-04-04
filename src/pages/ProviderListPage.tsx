import {
  ConditionsTable,
  CreateResourceButton,
  Link,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useLocation } from 'react-router-dom';
import { HealthyStatus, InstalledStatus } from '../components/ConditionStatus';
import { packageResourceColumns } from '../components/columns';
import { Provider } from '../resources';

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
            render: item => (
              <Link routeName={`crossplane-provider-detail-${item.metadata.name}`}>
                {item.metadata.name}
              </Link>
            ),
          },
          ...packageResourceColumns,
        ]}
      />
    </SectionBox>
  );
}

export function ProviderDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
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
    <>
      <MainInfoSection resource={provider} extraInfo={extraInfo} />
      {provider && <ConditionsTable resource={provider.jsonData} />}
    </>
  );
}
