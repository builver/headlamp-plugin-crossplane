import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  CreateResourceButton,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Link as MuiLink } from '@mui/material';
import { useLocation } from 'react-router-dom';
import { ReadyStatus } from '../../components/ConditionStatus';
import { ClusterUsage, Usage } from '../../resources';

function getOfLabel(item: any): string {
  const of = item.jsonData?.spec?.of;
  if (!of) return '-';
  const kind = of.kind ?? '';
  const name = of.resourceRef?.name ?? '';
  return name ? `${kind}/${name}` : kind || '-';
}

function getByLabel(item: any): string {
  const by = item.jsonData?.spec?.by;
  if (!by) return '-';
  const kind = by.kind ?? '';
  const name = by.resourceRef?.name ?? '';
  return name ? `${kind}/${name}` : kind || '-';
}

function UsageNameLink({ item, prefix }: { item: any; prefix: string }) {
  const launch = () =>
    Activity.launch({
      id: `crossplane-usage-${prefix}-${item.metadata.name}`,
      title: `${item.jsonData?.kind ?? 'Usage'} ${item.metadata.name}`,
      hideTitleInHeader: true,
      location: 'split-right',
      cluster: item.cluster,
      content: <UsageDetailInner item={item} />,
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

function UsageDetailInner({ item }: { item: any }) {
  const of = item?.jsonData?.spec?.of;
  const by = item?.jsonData?.spec?.by;

  const extraInfo = item
    ? [
        { name: 'Reason', value: item.jsonData?.spec?.reason ?? '-' },
        {
          name: 'Protected Resource (of)',
          value: of
            ? `${of.apiVersion ?? ''}/${of.kind ?? ''} ${of.resourceRef?.name ?? ''}`
            : '-',
        },
        {
          name: 'Using Resource (by)',
          value: by
            ? `${by.apiVersion ?? ''}/${by.kind ?? ''} ${by.resourceRef?.name ?? ''}`
            : '-',
        },
      ]
    : [];

  return (
    <Box pb={9}>
      <MainInfoSection resource={item} extraInfo={extraInfo} />
    </Box>
  );
}

const usageColumns = (prefix: string) => [
  {
    label: 'Name',
    getValue: (item: any) => item.metadata.name,
    render: (item: any) => <UsageNameLink item={item} prefix={prefix} />,
  },
  {
    label: 'Reason',
    getValue: (item: any) => item.jsonData?.spec?.reason ?? '-',
  },
  {
    label: 'Of',
    getValue: (item: any) => getOfLabel(item),
  },
  {
    label: 'By',
    getValue: (item: any) => getByLabel(item),
  },
  {
    label: 'Ready',
    getValue: (item: any) => item.jsonData?.status?.conditions?.find((c: any) => c.type === 'Ready')?.status ?? '-',
    render: (item: any) => <ReadyStatus item={item} />,
  },
  'age' as const,
];

export function UsageListPage() {
  const filterFunction = useFilterFunc();
  const [usages] = Usage.useList();
  const [clusterUsages] = ClusterUsage.useList();

  return (
    <>
      <SectionBox
        title={
          <SectionFilterHeader
            title="Usages (Namespaced)"
            titleSideActions={[<CreateResourceButton resourceClass={Usage} resourceName="Usage" />]}
          />
        }
      >
        <ResourceTable.default
          data={usages}
          filterFunction={filterFunction}
          enableRowActions
          columns={[
            ...usageColumns('usage').slice(0, 1),
            'namespace' as const,
            ...usageColumns('usage').slice(1),
          ]}
        />
      </SectionBox>
      <SectionBox
        title={
          <SectionFilterHeader
            title="Cluster Usages"
            noNamespaceFilter
            titleSideActions={[<CreateResourceButton resourceClass={ClusterUsage} resourceName="ClusterUsage" />]}
          />
        }
      >
        <ResourceTable.default
          data={clusterUsages}
          enableRowActions
          columns={usageColumns('cluster-usage')}
        />
      </SectionBox>
    </>
  );
}

export function UsageDetailPage() {
  const location = useLocation();
  const parts = location.pathname.split('/').filter(Boolean);
  const namespace = parts.length >= 4 ? parts[parts.length - 2] : undefined;
  const name = parts[parts.length - 1] ?? '';

  const [item] = namespace ? Usage.useGet(name, namespace) : Usage.useGet(name);

  return (
    <Box pb={9}>
      <MainInfoSection
        resource={item}
        extraInfo={
          item
            ? [
                { name: 'Reason', value: item.jsonData?.spec?.reason ?? '-' },
                {
                  name: 'Protected Resource (of)',
                  value: (() => {
                    const of = item.jsonData?.spec?.of;
                    return of
                      ? `${of.apiVersion ?? ''}/${of.kind ?? ''} ${of.resourceRef?.name ?? ''}`
                      : '-';
                  })(),
                },
                {
                  name: 'Using Resource (by)',
                  value: (() => {
                    const by = item.jsonData?.spec?.by;
                    return by
                      ? `${by.apiVersion ?? ''}/${by.kind ?? ''} ${by.resourceRef?.name ?? ''}`
                      : '-';
                  })(),
                },
              ]
            : []
        }
      />
    </Box>
  );
}

export function ClusterUsageDetailPage() {
  const location = useLocation();
  const name = location.pathname.split('/').filter(Boolean).pop() ?? '';
  const [item] = ClusterUsage.useGet(name);

  return (
    <Box pb={9}>
      <MainInfoSection
        resource={item}
        extraInfo={
          item
            ? [
                { name: 'Reason', value: item.jsonData?.spec?.reason ?? '-' },
                {
                  name: 'Protected Resource (of)',
                  value: (() => {
                    const of = item.jsonData?.spec?.of;
                    return of
                      ? `${of.apiVersion ?? ''}/${of.kind ?? ''} ${of.resourceRef?.name ?? ''}`
                      : '-';
                  })(),
                },
                {
                  name: 'Using Resource (by)',
                  value: (() => {
                    const by = item.jsonData?.spec?.by;
                    return by
                      ? `${by.apiVersion ?? ''}/${by.kind ?? ''} ${by.resourceRef?.name ?? ''}`
                      : '-';
                  })(),
                },
              ]
            : []
        }
      />
    </Box>
  );
}
