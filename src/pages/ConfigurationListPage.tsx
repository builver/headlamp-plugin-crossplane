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
import { Configuration } from '../resources';

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
      <ResourceTable.default
        data={configurations}
        filterFunction={filterFunction}
        enableRowActions
        columns={[
          {
            label: 'Name',
            getValue: item => item.metadata.name,
            render: item => (
              <Link routeName={`crossplane-configuration-detail-${item.metadata.name}`}>
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

export function ConfigurationDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [config] = Configuration.useGet(name);

  const extraInfo = config
    ? [
        { name: 'Installed', value: <InstalledStatus item={config} /> },
        { name: 'Healthy', value: <HealthyStatus item={config} /> },
        { name: 'Package', value: config.jsonData?.spec?.package ?? '-' },
        { name: 'Pull Policy', value: config.jsonData?.spec?.packagePullPolicy ?? '-' },
        {
          name: 'Revision Activation Policy',
          value: config.jsonData?.spec?.revisionActivationPolicy ?? '-',
        },
        { name: 'Current Revision', value: config.jsonData?.status?.currentRevision ?? '-' },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={config} extraInfo={extraInfo} />
      {config && <ConditionsTable resource={config.jsonData} />}
    </>
  );
}
