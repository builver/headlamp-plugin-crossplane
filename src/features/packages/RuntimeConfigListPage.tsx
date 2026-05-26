import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Chip, Link as MuiLink, ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { DeploymentRuntimeConfig } from '../../resources';
import { RuntimeConfigCreatePanel } from './RuntimeConfigCreateDialog';

const RC_ICON = <Icon icon="mdi:cog-play" width="100%" height="100%" />;

function launchCreatePanel(cluster?: string) {
  const id = `crossplane-runtimeconfig-create-${Date.now()}`;
  Activity.launch({
    id,
    title: 'Create Runtime Config',
    hideTitleInHeader: true,
    location: 'split-right',
    cluster,
    icon: RC_ICON,
    content: <RuntimeConfigCreatePanel onDone={() => Activity.close(id)} activityId={id} cluster={cluster} />,
  });
}

function launchEditPanel(item: any) {
  const id = `crossplane-runtimeconfig-edit-${item.metadata.name}`;
  Activity.launch({
    id,
    title: `Edit ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: RC_ICON,
    content: <RuntimeConfigCreatePanel existing={item} onDone={() => Activity.close(id)} activityId={id} cluster={item.cluster} />,
  });
}

function RuntimeConfigNameLink({ item }: { item: any }) {
  const launch = () =>
    Activity.launch({
      id: `crossplane-runtimeconfig-${item.metadata.name}`,
      title: `RuntimeConfig ${item.metadata.name}`,
      hideTitleInHeader: true,
      location: 'split-right',
      cluster: item.cluster,
      icon: RC_ICON,
      content: <RuntimeConfigDetailInner name={item.metadata.name} />,
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

export function RuntimeConfigListPage() {
  const filterFunction = useFilterFunc();
  const [items, error] = DeploymentRuntimeConfig.useList();

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

  if (error?.status === 404) {
    return (
      <SectionBox title="Runtime Configs">
        <p>DeploymentRuntimeConfigs not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Runtime Configs"
          titleSideActions={[
            <ActionButton
              description="Create Runtime Config"
              icon="mdi:plus-circle"
              onClick={() => launchCreatePanel(items?.[0]?.cluster)}
            />,
          ]}
        />
      }
    >
      <ResourceTable.default
        data={items}
        filterFunction={filterFunction}
        enableRowActions
        actions={[guiEditAction]}
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => <RuntimeConfigNameLink item={item} />,
          },
          {
            label: 'Kind',
            getValue: (item: any) => item.jsonData?.kind ?? '-',
          },
          {
            label: 'SA Name',
            getValue: (item: any) =>
              item.jsonData?.spec?.serviceAccountTemplate?.metadata?.name ?? '-',
          },
          {
            label: 'Replicas',
            getValue: (item: any) =>
              item.jsonData?.spec?.deploymentTemplate?.spec?.replicas ?? '-',
          },
          {
            label: 'Container Args',
            getValue: (item: any) => {
              const containers: any[] =
                item.jsonData?.spec?.deploymentTemplate?.spec?.template?.spec?.containers ?? [];
              const rt = containers.find((c: any) => c.name === 'package-runtime') ?? containers[0];
              return (rt?.args ?? []).join(' ') || '-';
            },
            render: (item: any) => {
              const containers: any[] =
                item.jsonData?.spec?.deploymentTemplate?.spec?.template?.spec?.containers ?? [];
              const rt = containers.find((c: any) => c.name === 'package-runtime') ?? containers[0];
              const args: string[] = rt?.args ?? [];
              if (args.length === 0) return <span>-</span>;
              return (
                <Box display="flex" flexWrap="wrap" gap={0.5}>
                  {args.map((a: string, i: number) => (
                    <Chip key={i} label={a} size="small" variant="outlined" />
                  ))}
                </Box>
              );
            },
          },
          'age',
        ]}
      />
    </SectionBox>
  );
}

export function RuntimeConfigDetailInner({ name }: { name: string }) {
  const [item] = DeploymentRuntimeConfig.useGet(name);

  const actions = useMemo(
    () => () =>
      [
        <ActionButton
          key="edit"
          description="Edit"
          icon="mdi:pencil"
          onClick={() => item && launchEditPanel(item)}
        />,
      ],
    [item]
  );

  const spec = item?.jsonData?.spec;
  const saTpl = spec?.serviceAccountTemplate;
  const dTpl = spec?.deploymentTemplate;
  const containers: any[] = dTpl?.spec?.template?.spec?.containers ?? [];
  const runtimeContainer =
    containers.find((c: any) => c.name === 'package-runtime') ?? containers[0];

  const saAnnotations = saTpl?.metadata?.annotations;
  const deployLabels = dTpl?.metadata?.labels;
  const deployAnnotations = dTpl?.metadata?.annotations;

  const extraInfo = item
    ? [
        {
          name: 'SA Name',
          value: saTpl?.metadata?.name ?? '-',
        },
        {
          name: 'SA Annotations',
          value: saAnnotations ? (
            <Box display="flex" flexWrap="wrap" gap={0.5}>
              {Object.entries(saAnnotations).map(([k, v]) => (
                <Chip key={k} label={`${k}=${v}`} size="small" variant="outlined" />
              ))}
            </Box>
          ) : (
            '-'
          ),
        },
        { name: 'Replicas', value: dTpl?.spec?.replicas ?? '-' },
        {
          name: 'Deploy Labels',
          value: deployLabels ? (
            <Box display="flex" flexWrap="wrap" gap={0.5}>
              {Object.entries(deployLabels).map(([k, v]) => (
                <Chip key={k} label={`${k}=${v}`} size="small" variant="outlined" />
              ))}
            </Box>
          ) : (
            '-'
          ),
        },
        {
          name: 'Deploy Annotations',
          value: deployAnnotations ? (
            <Box display="flex" flexWrap="wrap" gap={0.5}>
              {Object.entries(deployAnnotations).map(([k, v]) => (
                <Chip key={k} label={`${k}=${v}`} size="small" variant="outlined" />
              ))}
            </Box>
          ) : (
            '-'
          ),
        },
        {
          name: 'Container Args',
          value: runtimeContainer?.args?.length ? (
            <Box display="flex" flexWrap="wrap" gap={0.5}>
              {runtimeContainer.args.map((a: string, i: number) => (
                <Chip key={i} label={a} size="small" variant="outlined" />
              ))}
            </Box>
          ) : (
            '-'
          ),
        },
        {
          name: 'Environment Variables',
          value: runtimeContainer?.env?.length ? (
            <Box display="flex" flexWrap="wrap" gap={0.5}>
              {runtimeContainer.env.map((e: any, i: number) => (
                <Chip key={i} label={`${e.name}=${e.value ?? ''}`} size="small" variant="outlined" />
              ))}
            </Box>
          ) : (
            '-'
          ),
        },
      ]
    : [];

  return (
    <Box pb={9}>
      <MainInfoSection
        resource={item}
        extraInfo={extraInfo}
        actions={actions}
        noDefaultActions
      />
    </Box>
  );
}

export function RuntimeConfigDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <RuntimeConfigDetailInner name={name} />;
}
