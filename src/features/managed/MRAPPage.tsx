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
import { HealthyStatus } from '../../components/ConditionStatus';
import { ManagedResourceActivationPolicy, ManagedResourceDefinition } from '../../resources';
import { MRAPCreatePanel } from './MRAPCreateDialog';

const MRAP_ICON = <Icon icon="mdi:shield-check" width="100%" height="100%" />;

function launchCreatePanel(cluster?: string) {
  const id = `crossplane-mrap-create-${Date.now()}`;
  Activity.launch({
    id,
    title: 'Create Activation Policy',
    hideTitleInHeader: true,
    location: 'split-right',
    cluster,
    icon: MRAP_ICON,
    content: <MRAPCreatePanel onDone={() => Activity.close(id)} activityId={id} cluster={cluster} />,
  });
}

function launchEditPanel(item: any) {
  const id = `crossplane-mrap-edit-${item.metadata.name}`;
  Activity.launch({
    id,
    title: `Edit ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: MRAP_ICON,
    content: <MRAPCreatePanel existing={item} onDone={() => Activity.close(id)} activityId={id} cluster={item.cluster} />,
  });
}

function MRAPNameLink({ item }: { item: any }) {
  const launch = () =>
    Activity.launch({
      id: `crossplane-mrap-${item.metadata.name}`,
      title: `MRAP ${item.metadata.name}`,
      hideTitleInHeader: true,
      location: 'split-right',
      cluster: item.cluster,
      icon: MRAP_ICON,
      content: <MRAPDetailInner name={item.metadata.name} />,
    });
  return (
    <MuiLink
      component="button"
      onClick={launch}
      sx={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
    >
      {item.metadata.name}
    </MuiLink>
  );
}

export function MRAPListPage() {
  const [mraps] = ManagedResourceActivationPolicy.useList();
  const filterFunction = useFilterFunc();

  const guiEditAction = useMemo(
    () => ({
      id: 'GUI_EDIT',
      action: ({ item, closeMenu }: { item: any; closeMenu: () => void }) => (
        <MenuItem
          key="gui-edit"
          onClick={() => {
            closeMenu();
            launchEditPanel(item);
          }}
        >
          <ListItemIcon>
            <Icon icon="mdi:wizard-hat" />
          </ListItemIcon>
          <ListItemText>GUI Edit</ListItemText>
        </MenuItem>
      ),
    }),
    []
  );

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Activation Policies"
          titleSideActions={[
            <ActionButton
              description="Create Activation Policy"
              icon="mdi:plus-circle"
              onClick={() => launchCreatePanel(mraps?.[0]?.cluster)}
            />,
          ]}
        />
      }
    >
      <ResourceTable.default
        data={mraps}
        filterFunction={filterFunction}
        enableRowActions
        actions={[guiEditAction]}
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => <MRAPNameLink item={item} />,
          },
          {
            label: 'Patterns',
            getValue: (item: any) => {
              const patterns: string[] = item.jsonData?.spec?.activate ?? [];
              return patterns.join('\n') || '-';
            },
            render: (item: any) => {
              const patterns: string[] = item.jsonData?.spec?.activate ?? [];
              if (patterns.length === 0) return <span>-</span>;
              return (
                <div>
                  {patterns.map((p: string) => (
                    <div key={p}>{p}</div>
                  ))}
                </div>
              );
            },
          },
          {
            label: 'Activated',
            getValue: (item: any) => item.jsonData?.status?.activated?.length ?? 0,
          },
          {
            label: 'Healthy',
            getValue: (item: any) =>
              item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Healthy')?.status ??
              '-',
            render: (item: any) => <HealthyStatus item={item} />,
          },
          'age',
        ]}
      />
    </SectionBox>
  );
}

export function MRAPDetailInner({ name }: { name: string }) {
  const [mrap] = ManagedResourceActivationPolicy.useGet(name);
  const [mrds] = ManagedResourceDefinition.useList();

  const patterns: string[] = mrap?.jsonData?.spec?.activate ?? [];
  const activatedNames: string[] = mrap?.jsonData?.status?.activated ?? [];

  const activatedMRDs = mrds?.filter(mrd => activatedNames.includes(mrd.metadata.name)) ?? [];

  const actions = useMemo(
    () => () =>
      [
        <ActionButton
          key="edit"
          description="Edit"
          icon="mdi:pencil"
          onClick={() => mrap && launchEditPanel(mrap)}
        />,
      ],
    [mrap]
  );

  const extraInfo = mrap
    ? [
        {
          name: 'Activate Patterns',
          value:
            patterns.length > 0 ? (
              <div>
                {patterns.map(p => (
                  <div key={p}>{p}</div>
                ))}
              </div>
            ) : (
              '-'
            ),
        },
        {
          name: 'Activated Count',
          value: activatedNames.length,
        },
      ]
    : [];

  return (
    <Box pb={9}>
      <MainInfoSection resource={mrap} extraInfo={extraInfo} actions={actions} noDefaultActions />
      {mrap && <ConditionsTable resource={mrap.jsonData} />}
      <SectionBox title="Activated Managed Resources">
        <Table
          data={activatedMRDs}
          loading={mrds === null}
          columns={[
            {
              header: 'Name',
              accessorFn: (item: any) => item.metadata.name,
              Cell: ({ row: { original: item } }: any) => (
                <Link routeName={`crossplane-mrd-detail-${item.metadata.name}`}>
                  {item.metadata.name}
                </Link>
              ),
            },
            {
              header: 'Group',
              accessorFn: (item: any) => item.jsonData?.spec?.group ?? '-',
            },
            {
              header: 'Kind',
              accessorFn: (item: any) => item.jsonData?.spec?.names?.kind ?? '-',
            },
          ]}
        />
      </SectionBox>
    </Box>
  );
}

export function MRAPDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <MRAPDetailInner name={name} />;
}
