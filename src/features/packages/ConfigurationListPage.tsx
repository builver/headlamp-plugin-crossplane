import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  ConditionsTable,
  Link,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Link as MuiLink, ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { packageResourceColumns } from '../../components/columns';
import { HealthyStatus, InstalledStatus } from '../../components/ConditionStatus';
import { CompositeResourceDefinition, Configuration, ConfigurationRevision } from '../../resources';
import { PackageCreatePanel } from './PackageCreateDialog';

const CFG_ICON = <Icon icon="mdi:package-variant" width="100%" height="100%" />;

function launchCreatePanel(cluster?: string) {
  const id = `crossplane-configuration-create-${Date.now()}`;
  Activity.launch({
    id,
    title: 'Create Configuration',
    hideTitleInHeader: true,
    location: 'split-right',
    cluster,
    icon: CFG_ICON,
    content: <PackageCreatePanel kind="Configuration" onDone={() => Activity.close(id)} />,
  });
}

function launchEditPanel(item: any) {
  const id = `crossplane-configuration-edit-${item.metadata.name}`;
  Activity.launch({
    id,
    title: `Edit ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: CFG_ICON,
    content: <PackageCreatePanel kind="Configuration" existing={item} onDone={() => Activity.close(id)} />,
  });
}

function ConfigurationNameLink({ item }: { item: any }) {
  const launch = () => Activity.launch({
    id: `crossplane-configuration-${item.metadata.name}`,
    title: `Configuration ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: CFG_ICON,
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

export function ConfigurationListPage() {
  const filterFunction = useFilterFunc();
  const [configurations, error] = Configuration.useList();

  const guiEditAction = useMemo(
    () => ({
      id: 'GUI_EDIT',
      action: ({ item, closeMenu }: { item: any; closeMenu: () => void }) => (
        <MenuItem key="gui-edit" onClick={() => { closeMenu(); launchEditPanel(item); }}>
          <ListItemIcon><Icon icon="mdi:wizard-hat" /></ListItemIcon>
          <ListItemText>GUI Edit</ListItemText>
        </MenuItem>
      ),
    }),
    []
  );

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
          titleSideActions={[
            <ActionButton
              description="Create Configuration"
              icon="mdi:plus-circle"
              onClick={() => launchCreatePanel(configurations?.[0]?.cluster)}
            />,
          ]}
        />
      }
    >
      <ResourceTable.default
        data={configurations}
        filterFunction={filterFunction}
        enableRowActions
        actions={[guiEditAction]}
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => <ConfigurationNameLink item={item} />,
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
  const actions = useMemo(
    () => () =>
      [
        <ActionButton
          key="edit"
          description="Edit"
          icon="mdi:pencil"
          onClick={() => config && launchEditPanel(config)}
        />,
      ],
    [config]
  );

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
      <MainInfoSection resource={config} extraInfo={extraInfo} actions={actions} noDefaultActions />
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
