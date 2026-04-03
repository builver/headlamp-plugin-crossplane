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
import { HealthyStatus, InstalledStatus } from '../components/ConditionStatus';
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
      <Table
        data={functions}
        loading={functions === null}
        filterFunction={filterFunction}
        columns={[
          {
            header: 'Name',
            accessorKey: 'metadata.name',
            Cell: ({ row: { original: item } }) => (
              <Link routeName={`crossplane-function-detail-${item.metadata.name}`}>
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
            accessorFn: item => item.jsonData?.status?.conditions?.find(c => c.type === 'Healthy')?.status ?? '-',
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
