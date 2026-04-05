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
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { HealthyStatus, InstalledStatus } from '../components/ConditionStatus';
import { makeCompositeTypeColumn, packageResourceColumns } from '../components/columns';
import { Composition, CompositeResourceDefinition, CrossplaneFunction } from '../resources';

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

function CompositionsUsingFunction({ functionName }: { functionName: string }) {
  const filterFunction = useFilterFunc();
  const [compositions] = Composition.useList();
  const [xrds] = CompositeResourceDefinition.useList();

  const filtered = useMemo(
    () =>
      compositions?.filter(c =>
        (c.jsonData?.spec?.pipeline ?? []).some(
          (s: { functionRef?: { name?: string } }) => s.functionRef?.name === functionName
        )
      ) ?? [],
    [compositions, functionName]
  );

  if (!filtered.length) return null;

  return (
    <SectionBox title="Used by Compositions">
      <ResourceTable.default
        data={filtered}
        filterFunction={filterFunction}
        enableRowActions
        columns={[
          {
            label: 'Name',
            getValue: item => item.metadata.name,
            render: item => (
              <Link routeName={`crossplane-composition-detail-${item.metadata.name}`}>
                {item.metadata.name}
              </Link>
            ),
          },
          makeCompositeTypeColumn(xrds),
          'age' as const,
        ]}
      />
    </SectionBox>
  );
}

export function FunctionDetailInner({ name }: { name: string }) {
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
      {fn && <CompositionsUsingFunction functionName={fn.metadata.name} />}
    </>
  );
}

export function FunctionDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <FunctionDetailInner name={name} />;
}
