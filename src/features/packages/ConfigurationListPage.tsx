import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  ConditionsTable,
  CreateResourceButton,
  Link,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Link as MuiLink } from '@mui/material';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { packageResourceColumns } from '../../components/columns';
import { HealthyStatus, InstalledStatus } from '../../components/ConditionStatus';
import { CompositeResourceDefinition, Configuration, ConfigurationRevision } from '../../resources';

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
            render: item => <ConfigurationNameLink item={item} />,
          },
          ...packageResourceColumns,
        ]}
      />
    </SectionBox>
  );
}

interface ObjectRef {
  apiVersion: string;
  kind: string;
  name: string;
}

function ObjectRefName({ objectRef, xrdPlural }: { objectRef: ObjectRef; xrdPlural?: string }) {
  if (objectRef.kind === 'CompositeResourceDefinition' && xrdPlural) {
    return <Link routeName={`crossplane-xr-kind-${xrdPlural}`}>{objectRef.name}</Link>;
  }
  if (objectRef.kind === 'Composition') {
    return <Link routeName={`crossplane-composition-detail-${objectRef.name}`}>{objectRef.name}</Link>;
  }
  return <>{objectRef.name}</>;
}

function ObjectRefsSection({ revisionName }: { revisionName: string }) {
  const [revision] = ConfigurationRevision.useGet(revisionName);
  const [xrds] = CompositeResourceDefinition.useList();
  const refs: ObjectRef[] = revision?.jsonData?.status?.objectRefs ?? [];

  const xrdPluralByName = useMemo(
    () => new Map(xrds?.map(x => [x.metadata.name as string, x.jsonData?.spec?.names?.plural as string]) ?? []),
    [xrds],
  );

  if (revision && !refs.length) return null;

  return (
    <SectionBox title="Installed Objects">
      <Table
        data={refs}
        columns={[
          { header: 'Kind', accessorKey: 'kind' },
          { header: 'API Version', accessorKey: 'apiVersion' },
          {
            header: 'Name',
            accessorKey: 'name',
            Cell: ({ row }: { row: { original: ObjectRef } }) => (
              <ObjectRefName objectRef={row.original} xrdPlural={xrdPluralByName.get(row.original.name)} />
            ),
          },
        ]}
      />
    </SectionBox>
  );
}

export function ConfigurationDetailInner({ name }: { name: string }) {
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

  const currentRevision: string | undefined = config?.jsonData?.status?.currentRevision;

  return (
    <Box pb={9}>
      <MainInfoSection resource={config} extraInfo={extraInfo} />
      {config && <ConditionsTable resource={config.jsonData} />}
      {currentRevision && <ObjectRefsSection revisionName={currentRevision} />}
    </Box>
  );
}

export function ConfigurationDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <ConfigurationDetailInner name={name} />;
}

function ConfigurationNameLink({ item }: { item: any }) {
  const launch = () => Activity.launch({
    id: `crossplane-configuration-${item.metadata.name}`,
    title: `Configuration ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: <Icon icon="mdi:package-variant" width="100%" height="100%" />,
    content: <ConfigurationDetailInner name={item.metadata.name} />,
  });
  return (
    <MuiLink component="button" onClick={launch}
      sx={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
    >
      {item.metadata.name}
    </MuiLink>
  );
}
