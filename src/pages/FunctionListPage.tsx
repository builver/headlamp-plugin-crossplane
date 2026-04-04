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
import { CrossplaneFunction } from '../resources';

export function FunctionListPage() {
  const filterFunction = useFilterFunc();
  const [functions, error] = CrossplaneFunction.useList();

  if (error?.status === 404) {
    return (
      <SectionBox title="Functions">
        <p>Functions not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Functions"
          titleSideActions={[<CreateResourceButton resourceClass={CrossplaneFunction} resourceName="Function" />]}
        />
      }
    >
      <ResourceTable.default
        data={functions}
        filterFunction={filterFunction}
        enableRowActions
        columns={[
          {
            label: 'Name',
            getValue: item => item.metadata.name,
            render: item => (
              <Link routeName={`crossplane-function-detail-${item.metadata.name}`}>
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

export function FunctionDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [fn] = CrossplaneFunction.useGet(name);

  const extraInfo = fn
    ? [
        { name: 'Installed', value: <InstalledStatus item={fn} /> },
        { name: 'Healthy', value: <HealthyStatus item={fn} /> },
        { name: 'Package', value: fn.jsonData?.spec?.package ?? '-' },
        { name: 'Pull Policy', value: fn.jsonData?.spec?.packagePullPolicy ?? '-' },
        {
          name: 'Revision Activation Policy',
          value: fn.jsonData?.spec?.revisionActivationPolicy ?? '-',
        },
        { name: 'Current Revision', value: fn.jsonData?.status?.currentRevision ?? '-' },
      ]
    : [];

  return (
    <>
      <MainInfoSection resource={fn} extraInfo={extraInfo} />
      {fn && <ConditionsTable resource={fn.jsonData} />}
    </>
  );
}
