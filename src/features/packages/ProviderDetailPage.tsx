import { Icon } from '@iconify/react';
import { Activity, K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  ActionButton,
  ConditionsTable,
  DateLabel,
  MainInfoSection,
  SectionBox,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { Box, Link as MuiLink } from '@mui/material';
import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { linkSx } from '../../components/ActivityNameLink';
import { HealthyStatus, InstalledStatus, ReadyStatus } from '../../components/ConditionStatus';
import { Provider, ProviderRevision } from '../../resources';
import { ConfigCRDInfo, getOrCreateClass } from '../../resources/crdClassCache';
import { PackageCreatePanel } from './PackageCreateDialog';
import { PackageRevisionsSection } from './PackageRevisionsSection';
import { ProviderConfigDetailInner } from './ProviderConfigDetailPage';

const PROVIDER_ICON = <Icon icon="mdi:puzzle-outline" width="100%" height="100%" />;

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

export function ProviderDetailInner({ name }: { name: string }) {
  const [provider] = Provider.useGet(name);
  const actions = useMemo(
    () => () =>
      [
        <ActionButton
          key="edit"
          description="Edit"
          icon="mdi:pencil"
          onClick={() => provider && launchEditPanel(provider)}
        />,
      ],
    [provider]
  );

  const extraInfo = provider
    ? [
        { name: 'Installed', value: <InstalledStatus item={provider} /> },
        { name: 'Healthy', value: <HealthyStatus item={provider} /> },
        { name: 'Package', value: provider.jsonData?.spec?.package ?? '-' },
        { name: 'Pull Policy', value: provider.jsonData?.spec?.packagePullPolicy ?? '-' },
        {
          name: 'Revision Activation Policy',
          value: provider.jsonData?.spec?.revisionActivationPolicy ?? '-',
        },
        { name: 'Current Revision', value: provider.jsonData?.status?.currentRevision ?? '-' },
      ]
    : [];

  return (
    <Box pb={9}>
      <MainInfoSection resource={provider} extraInfo={extraInfo} actions={actions} noDefaultActions />
      {provider && <ConditionsTable resource={provider.jsonData} />}
      {provider && (
        <PackageRevisionsSection
          parentName={name}
          RevisionClass={ProviderRevision}
          currentRevision={provider.jsonData?.status?.currentRevision}
        />
      )}
      <ProviderConfigsSection providerName={name} />
    </Box>
  );
}

function ProviderConfigsSection({ providerName }: { providerName: string }) {
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();

  const configCRDs: ConfigCRDInfo[] = useMemo(() => {
    if (!crds) return [];
    const result: ConfigCRDInfo[] = [];
    for (const crd of crds) {
      const spec = crd.jsonData?.spec;
      const kind = spec?.names?.kind;
      if (kind !== 'ProviderConfig' && kind !== 'ClusterProviderConfig') continue;
      const group: string = spec.group;
      const groupFirst = group.split('.')[0];
      if (!groupFirst || !providerName.includes(groupFirst)) continue;
      result.push({
        crdName: crd.metadata.name,
        group,
        kind,
        plural: spec.names.plural,
        versions: (spec.versions ?? [])
          .filter((v: any) => v.served !== false)
          .map((v: any) => ({ group, version: v.name })),
        isNamespaced: spec.scope === 'Namespaced',
      });
    }
    return result;
  }, [crds, providerName]);

  if (configCRDs.length === 0) return null;

  return (
    <SectionBox title="Provider Configs">
      {configCRDs.map(cfg => (
        <ProviderConfigInstancesTable key={cfg.crdName} cfg={cfg} />
      ))}
    </SectionBox>
  );
}

function ProviderConfigInstancesTable({ cfg }: { cfg: ConfigCRDInfo }) {
  const Cls = getOrCreateClass(cfg);
  const [items] = Cls.useList();

  if (!items || items.length === 0) return null;

  return (
    <Table
      data={items}
      columns={[
        {
          header: 'Name',
          accessorFn: (item: any) => item.metadata.name,
          Cell: ({ row: { original: item } }: any) => {
            const launch = () => {
              Activity.launch({
                id: `crossplane-providerconfig-${cfg.crdName}-${item.metadata.name}`,
                title: `${cfg.kind} ${item.metadata.name}`,
                hideTitleInHeader: true,
                location: 'split-right',
                cluster: item.cluster,
                content: <ProviderConfigDetailInner crdName={cfg.crdName} name={item.metadata.name} />,
              });
            };
            return (
              <MuiLink component="button" onClick={launch} sx={linkSx}>
                {item.metadata.name}
              </MuiLink>
            );
          },
        },
        {
          header: 'Kind',
          accessorFn: () => cfg.kind,
        },
        {
          header: 'API Version',
          accessorFn: (item: any) => item.jsonData?.apiVersion ?? '-',
        },
        {
          header: 'Users',
          accessorFn: (item: any) => item.jsonData?.status?.users ?? 0,
        },
        {
          header: 'Ready',
          accessorFn: (item: any) => {
            const cond = item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Ready');
            return cond?.status ?? '-';
          },
          Cell: ({ row: { original: item } }: any) => <ReadyStatus item={item} />,
        },
        {
          header: 'Age',
          accessorFn: (item: any) => item.metadata.creationTimestamp ?? '',
          Cell: ({ row: { original: item } }: any) => (
            <DateLabel date={item.metadata.creationTimestamp} format="mini" />
          ),
        },
      ]}
    />
  );
}

export function ProviderDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  return <ProviderDetailInner name={name} />;
}
