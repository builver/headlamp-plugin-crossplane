import {
  ConditionsTable,
  CreateResourceButton,
  DateLabel,
  Link,
  MainInfoSection,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useLocation } from 'react-router-dom';
import { ReadyStatus, SyncedStatus } from '../components/ConditionStatus';
import { getHealthyCondition,Provider } from '../resources';

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
      <Table
        data={providers}
        loading={providers === null}
        filterFunction={filterFunction}
        columns={[
          {
            header: 'Name',
            accessorKey: 'metadata.name',
            Cell: ({ row: { original: item } }) => (
              <Link routeName={`crossplane-provider-detail-${item.metadata.name}`}>
                {item.metadata.name}
              </Link>
            ),
          },
          {
            header: 'Package',
            accessorFn: item => item.jsonData?.spec?.package ?? '-',
          },
          {
            header: 'Installed',
            accessorFn: item => {
              const cond = item.jsonData?.status?.conditions?.find(c => c.type === 'Installed');
              return cond?.status ?? '-';
            },
          },
          {
            header: 'Healthy',
            accessorFn: item => {
              const cond = getHealthyCondition(item);
              return cond?.status ?? '-';
            },
          },
          {
            header: 'Current Revision',
            accessorFn: item => item.jsonData?.status?.currentRevision ?? '-',
          },
          {
            header: 'Age',
            accessorFn: item => -new Date(item.metadata.creationTimestamp).getTime(),
            Cell: ({ row: { original: item } }) => (
              <DateLabel date={item.metadata.creationTimestamp} format="mini" />
            ),
          },
        ]}
      />
    </SectionBox>
  );
}

export function ProviderDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [provider] = Provider.useGet(name);

  const healthy = provider ? getHealthyCondition(provider) : null;

  const extraInfo = provider
    ? [
        { name: 'Ready', value: <ReadyStatus item={provider} /> },
        { name: 'Synced', value: <SyncedStatus item={provider} /> },
        { name: 'Package', value: provider.jsonData?.spec?.package ?? '-' },
        { name: 'Pull Policy', value: provider.jsonData?.spec?.packagePullPolicy ?? '-' },
        {
          name: 'Revision Activation Policy',
          value: provider.jsonData?.spec?.revisionActivationPolicy ?? '-',
        },
        { name: 'Current Revision', value: provider.jsonData?.status?.currentRevision ?? '-' },
        { name: 'Healthy', value: healthy?.status ?? '-' },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={provider} extraInfo={extraInfo} />
      {provider && <ConditionsTable resource={provider.jsonData} />}
    </>
  );
}
