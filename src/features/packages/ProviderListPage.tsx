import { Icon } from '@iconify/react';
import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Link as MuiLink, ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import { useMemo } from 'react';
import { linkSx } from '../../components/ActivityNameLink';
import { packageResourceColumns } from '../../components/columns';
import { Provider } from '../../resources';
import { PackageCreatePanel } from './PackageCreateDialog';
import { ProviderDetailInner } from './ProviderDetailPage';

const PROVIDER_ICON = <Icon icon="mdi:puzzle-outline" width="100%" height="100%" />;

function launchCreatePanel(cluster?: string) {
  const id = `crossplane-provider-create-${Date.now()}`;
  Activity.launch({
    id,
    title: 'Create Provider',
    hideTitleInHeader: true,
    location: 'split-right',
    cluster,
    icon: PROVIDER_ICON,
    content: <PackageCreatePanel kind="Provider" onDone={() => Activity.close(id)} activityId={id} cluster={cluster} />,
  });
}

function launchEditPanel(item: any) {
  const id = `crossplane-provider-edit-${item.metadata.name}`;
  Activity.launch({
    id,
    title: `Edit ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: PROVIDER_ICON,
    content: <PackageCreatePanel kind="Provider" existing={item} onDone={() => Activity.close(id)} activityId={id} cluster={item.cluster} />,
  });
}

function ProviderNameLink({ item }: { item: any }) {
  const launch = () => Activity.launch({
    id: `crossplane-provider-${item.metadata.name}`,
    title: `Provider ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: PROVIDER_ICON,
    content: <ProviderDetailInner name={item.metadata.name} />,
  });
  return (
    <MuiLink component="button" onClick={launch} sx={linkSx}>
      {item.metadata.name}
    </MuiLink>
  );
}

export function ProviderListPage() {
  const filterFunction = useFilterFunc();
  const [providers, error] = Provider.useList();

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
      <SectionBox title="Providers">
        <p>Providers not found. Is Crossplane installed?</p>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <SectionFilterHeader
          title="Providers"
          titleSideActions={[
            <ActionButton
              description="Create Provider"
              icon="mdi:plus-circle"
              onClick={() => launchCreatePanel(providers?.[0]?.cluster)}
            />,
          ]}
        />
      }
    >
      <ResourceTable.default
        data={providers}
        filterFunction={filterFunction}
        enableRowActions
        actions={[guiEditAction]}
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => <ProviderNameLink item={item} />,
          },
          ...packageResourceColumns,
        ]}
      />
    </SectionBox>
  );
}
