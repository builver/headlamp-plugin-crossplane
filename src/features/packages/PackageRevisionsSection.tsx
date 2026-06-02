import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  ConditionsTable,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  StatusLabel,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Box, Link as MuiLink, Tooltip, Typography } from '@mui/material';
import { useMemo } from 'react';
import { HealthyStatus } from '../../components/ConditionStatus';

function RevisionDetailInner({ RevisionClass, name }: { RevisionClass: typeof KubeObject; name: string }) {
  const [revision] = RevisionClass.useGet(name);
  const extraInfo = revision
    ? [
        { name: 'Revision', value: String(revision.jsonData?.spec?.revision ?? '-') },
        { name: 'State', value: revision.jsonData?.spec?.desiredState ?? '-' },
        { name: 'Healthy', value: <HealthyStatus item={revision} /> },
        { name: 'Image', value: revision.jsonData?.spec?.image ?? '-' },
        { name: 'Pull Policy', value: revision.jsonData?.spec?.packagePullPolicy ?? '-' },
      ]
    : [];

  return (
    <Box pb={9}>
      <MainInfoSection resource={revision} extraInfo={extraInfo} noDefaultActions backLink={null} />
      {revision && <ConditionsTable resource={revision.jsonData} />}
    </Box>
  );
}

function RevisionNameLink({
  item,
  isCurrent,
  RevisionClass,
}: {
  item: any;
  isCurrent: boolean;
  RevisionClass: typeof KubeObject;
}) {
  const revName: string = item.metadata.name;
  const launch = () => Activity.launch({
    id: `crossplane-revision-${revName}`,
    title: `${RevisionClass.kind} ${revName}`,
    hideTitleInHeader: true,
    location: 'split-right',
    cluster: item.cluster,
    content: <RevisionDetailInner RevisionClass={RevisionClass} name={revName} />,
  });
  return (
    <MuiLink
      component="button"
      onClick={launch}
      sx={{ background: 'none', border: 'none', padding: 0, font: 'inherit', cursor: 'pointer', fontWeight: isCurrent ? 700 : 400 }}
    >
      {revName}
    </MuiLink>
  );
}

interface PackageRevisionsSectionProps {
  parentName: string;
  RevisionClass: typeof KubeObject;
  currentRevision?: string;
}

export function PackageRevisionsSection({
  parentName,
  RevisionClass,
  currentRevision,
}: PackageRevisionsSectionProps) {
  const filterFunction = useFilterFunc();
  const [allRevisions] = RevisionClass.useList();

  const revisions = useMemo(
    () =>
      allRevisions?.filter((r: any) => {
        const labels: Record<string, string> = r.jsonData?.metadata?.labels ?? {};
        if (labels['pkg.crossplane.io/package'] === parentName) return true;
        const owners: any[] = r.jsonData?.metadata?.ownerReferences ?? [];
        return owners.some((o: any) => o.name === parentName);
      }) ?? [],
    [allRevisions, parentName]
  );

  if (allRevisions && !revisions.length) return null;

  return (
    <SectionBox title="Revisions">
      <ResourceTable.default
        data={revisions}
        filterFunction={filterFunction}
        columns={[
          {
            label: 'Name',
            getValue: (item: any) => item.metadata.name,
            render: (item: any) => (
              <RevisionNameLink
                item={item}
                isCurrent={item.metadata.name === currentRevision}
                RevisionClass={RevisionClass}
              />
            ),
          },
          {
            label: 'Revision',
            getValue: (item: any) => item.jsonData?.spec?.revision ?? 0,
            gridTemplate: 'min-content',
          },
          {
            label: 'State',
            getValue: (item: any) => item.jsonData?.spec?.desiredState ?? '-',
            render: (item: any) => {
              const state = item.jsonData?.spec?.desiredState;
              if (state === 'Active') return <StatusLabel status="success">Active</StatusLabel>;
              if (state === 'Inactive') return <StatusLabel status="">Inactive</StatusLabel>;
              return <span>{state ?? '-'}</span>;
            },
            gridTemplate: 'min-content',
          },
          {
            label: 'Healthy',
            getValue: (item: any) => {
              const conds: any[] = item.jsonData?.status?.conditions ?? [];
              return conds.find((c: any) => c.type === 'Healthy')?.status ?? '-';
            },
            render: (item: any) => <HealthyStatus item={item} />,
            gridTemplate: 'min-content',
          },
          {
            label: 'Image',
            getValue: (item: any) => item.jsonData?.spec?.image ?? '-',
            render: (item: any) => {
              const image = item.jsonData?.spec?.image ?? '-';
              return (
                <Tooltip title={image}>
                  <Typography variant="body2" noWrap sx={{ maxWidth: 300 }}>
                    {image}
                  </Typography>
                </Tooltip>
              );
            },
          },
          'age' as const,
        ]}
      />
    </SectionBox>
  );
}
