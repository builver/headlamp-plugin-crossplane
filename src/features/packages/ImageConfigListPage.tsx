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
import { ImageConfig } from '../../resources';
import { ImageConfigCreatePanel } from './ImageConfigCreateDialog';

const IC_ICON = <Icon icon="mdi:image-filter-center-focus" width="100%" height="100%" />;

function launchCreatePanel(cluster?: string) {
  const id = `crossplane-imageconfig-create-${Date.now()}`;
  Activity.launch({
    id,
    title: 'Create Image Config',
    hideTitleInHeader: true,
    location: 'split-right',
    cluster,
    icon: IC_ICON,
    content: <ImageConfigCreatePanel onDone={() => Activity.close(id)} activityId={id} cluster={cluster} />,
  });
}

function launchEditPanel(item: any) {
  const id = `crossplane-imageconfig-edit-${item.metadata.name}`;
  Activity.launch({
    id,
    title: `Edit ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: IC_ICON,
    content: <ImageConfigCreatePanel existing={item} onDone={() => Activity.close(id)} activityId={id} cluster={item.cluster} />,
  });
}

function ImageConfigNameLink({ item }: { item: any }) {
  const launch = () =>
    Activity.launch({
      id: `crossplane-imageconfig-${item.metadata.name}`,
      title: `ImageConfig ${item.metadata.name}`,
      hideTitleInHeader: true,
      location: 'split-right',
      cluster: item.cluster,
      icon: IC_ICON,
      content: <ImageConfigDetailInner name={item.metadata.name} />,
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

export function ImageConfigListPage() {
  const filterFunction = useFilterFunc();
  const [imageConfigs, error] = ImageConfig.useList();

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
      <SectionBox title="Image Configs">
        <p>ImageConfigs not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Image Configs"
          titleSideActions={[
            <ActionButton
              description="Create Image Config"
              icon="mdi:plus-circle"
              onClick={() => launchCreatePanel(imageConfigs?.[0]?.cluster)}
            />,
          ]}
        />
      }
    >
      <ResourceTable.default
        data={imageConfigs}
        filterFunction={filterFunction}
        enableRowActions
        actions={[guiEditAction]}
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => <ImageConfigNameLink item={item} />,
          },
          {
            label: 'Match Prefixes',
            getValue: (item: any) => {
              const matches: any[] = item.jsonData?.spec?.matchImages ?? [];
              return matches.map((m: any) => m.prefix ?? '').join(', ') || '-';
            },
            render: (item: any) => {
              const matches: any[] = item.jsonData?.spec?.matchImages ?? [];
              if (matches.length === 0) return <span>-</span>;
              return (
                <Box display="flex" flexWrap="wrap" gap={0.5}>
                  {matches.map((m: any, i: number) => (
                    <Chip key={i} label={m.prefix ?? '-'} size="small" variant="outlined" />
                  ))}
                </Box>
              );
            },
          },
          {
            label: 'Pull Secret',
            getValue: (item: any) =>
              item.jsonData?.spec?.registry?.authentication?.pullSecretRef?.name ?? '-',
          },
          {
            label: 'Rewrite Prefix',
            getValue: (item: any) => item.jsonData?.spec?.rewriteImage?.prefix ?? '-',
          },
          'age',
        ]}
      />
    </SectionBox>
  );
}

export function ImageConfigDetailInner({ name }: { name: string }) {
  const [imageConfig] = ImageConfig.useGet(name);

  const matches: any[] = imageConfig?.jsonData?.spec?.matchImages ?? [];
  const pullSecretName =
    imageConfig?.jsonData?.spec?.registry?.authentication?.pullSecretRef?.name;
  const rewritePrefix = imageConfig?.jsonData?.spec?.rewriteImage?.prefix;
  const runtimeRef = imageConfig?.jsonData?.spec?.runtime?.configRef?.name;

  const actions = useMemo(
    () => () =>
      [
        <ActionButton
          key="edit"
          description="Edit"
          icon="mdi:pencil"
          onClick={() => imageConfig && launchEditPanel(imageConfig)}
        />,
      ],
    [imageConfig]
  );

  const extraInfo = imageConfig
    ? [
        {
          name: 'Match Prefixes',
          value:
            matches.length > 0 ? (
              <Box display="flex" flexWrap="wrap" gap={0.5}>
                {matches.map((m: any, i: number) => (
                  <Chip key={i} label={m.prefix ?? '-'} size="small" variant="outlined" />
                ))}
              </Box>
            ) : (
              '-'
            ),
        },
        { name: 'Pull Secret', value: pullSecretName ?? '-' },
        { name: 'Rewrite Prefix', value: rewritePrefix ?? '-' },
        { name: 'Runtime Config', value: runtimeRef ?? '-' },
      ]
    : [];

  return (
    <Box pb={9}>
      <MainInfoSection
        resource={imageConfig}
        extraInfo={extraInfo}
        actions={actions}
        noDefaultActions
        backLink={null}
      />
    </Box>
  );
}

export function ImageConfigDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <ImageConfigDetailInner name={name} />;
}
