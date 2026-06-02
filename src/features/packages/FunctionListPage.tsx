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
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Link as MuiLink, ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { makeCompositeTypeColumn, packageResourceColumns } from '../../components/columns';
import { HealthyStatus, InstalledStatus } from '../../components/ConditionStatus';
import { CompositeResourceDefinition, Composition, CrossplaneFunction, FunctionRevision } from '../../resources';
import { PackageCreatePanel } from './PackageCreateDialog';
import { PackageRevisionsSection } from './PackageRevisionsSection';

const FN_ICON = <Icon icon="mdi:function" width="100%" height="100%" />;

function launchCreatePanel(cluster?: string) {
  const id = `crossplane-function-create-${Date.now()}`;
  Activity.launch({
    id,
    title: 'Create Function',
    hideTitleInHeader: true,
    location: 'split-right',
    cluster,
    icon: FN_ICON,
    content: <PackageCreatePanel kind="Function" onDone={() => Activity.close(id)} activityId={id} cluster={cluster} />,
  });
}

function launchEditPanel(item: any) {
  const id = `crossplane-function-edit-${item.metadata.name}`;
  Activity.launch({
    id,
    title: `Edit ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: FN_ICON,
    content: <PackageCreatePanel kind="Function" existing={item} onDone={() => Activity.close(id)} activityId={id} cluster={item.cluster} />,
  });
}

function FunctionNameLink({ item }: { item: any }) {
  const launch = () => Activity.launch({
    id: `crossplane-function-${item.metadata.name}`,
    title: `Function ${item.metadata.name}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    icon: FN_ICON,
    content: <FunctionDetailInner name={item.metadata.name} />,
  });
  return (
    <MuiLink component="button" onClick={launch}
      sx={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }}
    >
      {item.metadata.name}
    </MuiLink>
  );
}

export function FunctionListPage() {
  const filterFunction = useFilterFunc();
  const [functions, error] = CrossplaneFunction.useList();

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
          titleSideActions={[
            <ActionButton
              description="Create Function"
              icon="mdi:plus-circle"
              onClick={() => launchCreatePanel(functions?.[0]?.cluster)}
            />,
          ]}
        />
      }
    >
      <ResourceTable.default
        data={functions}
        filterFunction={filterFunction}
        enableRowActions
        actions={[guiEditAction]}
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => <FunctionNameLink item={item} />,
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
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => (
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
  const actions = useMemo(
    () => () =>
      [
        <ActionButton
          key="edit"
          description="Edit"
          icon="mdi:pencil"
          onClick={() => fn && launchEditPanel(fn)}
        />,
      ],
    [fn]
  );

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
    <Box pb={9}>
      <MainInfoSection
        resource={fn}
        extraInfo={extraInfo}
        actions={actions}
        noDefaultActions
        backLink={null}
      />
      {fn && <ConditionsTable resource={fn.jsonData} />}
      {fn && (
        <PackageRevisionsSection
          parentName={name}
          RevisionClass={FunctionRevision}
          currentRevision={fn.jsonData?.status?.currentRevision}
        />
      )}
      {fn && <CompositionsUsingFunction functionName={fn.metadata.name} />}
    </Box>
  );
}

export function FunctionDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <FunctionDetailInner name={name} />;
}
