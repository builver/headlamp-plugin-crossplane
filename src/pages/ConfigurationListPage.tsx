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
import { Configuration, getHealthyCondition } from '../resources';

export function ConfigurationListPage() {
  const filterFunction = useFilterFunc();
  const [configurations, error] = Configuration.useList();

  if (error?.status === 404) {
    return (
      <SectionBox title="Configurations">
        <p>Configurations not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Configurations"
          titleSideActions={[<CreateResourceButton resourceClass={Configuration} resourceName="Configuration" />]}
        />
      }
    >
      <Table
        data={configurations}
        loading={configurations === null}
        filterFunction={filterFunction}
        columns={[
          {
            header: 'Name',
            accessorKey: 'metadata.name',
            Cell: ({ row: { original: item } }) => (
              <Link routeName={`crossplane-configuration-detail-${item.metadata.name}`}>
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
            accessorFn: item => getHealthyCondition(item)?.status ?? '-',
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

export function ConfigurationDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [config] = Configuration.useGet(name);

  const healthy = config ? getHealthyCondition(config) : null;

  const extraInfo = config
    ? [
        { name: 'Ready', value: <ReadyStatus item={config} /> },
        { name: 'Synced', value: <SyncedStatus item={config} /> },
        { name: 'Package', value: config.jsonData?.spec?.package ?? '-' },
        { name: 'Pull Policy', value: config.jsonData?.spec?.packagePullPolicy ?? '-' },
        {
          name: 'Revision Activation Policy',
          value: config.jsonData?.spec?.revisionActivationPolicy ?? '-',
        },
        { name: 'Current Revision', value: config.jsonData?.status?.currentRevision ?? '-' },
        { name: 'Healthy', value: healthy?.status ?? '-' },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={config} extraInfo={extraInfo} />
      {config && <ConditionsTable resource={config.jsonData} />}
    </>
  );
}
