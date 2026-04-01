import {
  ConditionsTable,
  DateLabel,
  Link,
  MainInfoSection,
  SectionBox,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import Event from '@kinvolk/headlamp-plugin/lib/K8s/event';
import { Box, Typography } from '@mui/material';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ReadyStatus, SyncedStatus } from '../components/ConditionStatus';
import {
  CompositeResourceDefinition,
  getCompositionRef,
  getResponsiveCondition,
  getXRScope,
  makeXRClass,
  XRScope,
} from '../resources';

// ── Cluster-scoped XR detail ─────────────────────────────────────────────────

export function XRDetailClusterPage() {
  const { plural, name } = useParams<{ plural: string; name: string }>();
  const [xrds] = CompositeResourceDefinition.useList();
  const xrd = xrds?.find(x => x.jsonData?.spec?.names?.plural === plural) ?? null;

  if (!xrds) return <SectionBox title="Composite Resource"><p>Loading…</p></SectionBox>;
  if (!xrd)
    return (
      <SectionBox title="Composite Resource">
        <p>No XRD found for resource type "{plural}".</p>
      </SectionBox>
    );

  return <XRDetailInner xrd={xrd} name={name} />;
}

// ── Namespaced XR detail ──────────────────────────────────────────────────────

export function XRDetailNamespacedPage() {
  const { plural, namespace, name } = useParams<{
    plural: string;
    namespace: string;
    name: string;
  }>();
  const [xrds] = CompositeResourceDefinition.useList();
  const xrd = xrds?.find(x => x.jsonData?.spec?.names?.plural === plural) ?? null;

  if (!xrds) return <SectionBox title="Composite Resource"><p>Loading…</p></SectionBox>;
  if (!xrd)
    return (
      <SectionBox title="Composite Resource">
        <p>No XRD found for resource type "{plural}".</p>
      </SectionBox>
    );

  return <XRDetailInner xrd={xrd} name={name} namespace={namespace} />;
}

// ── Events section ────────────────────────────────────────────────────────────

interface XREventsSectionProps {
  item: KubeObject;
  kind: string;
}

function XREventsSection({ item, kind }: XREventsSectionProps) {
  const [events] = (Event as any).useList({
    namespace: item.metadata.namespace || undefined,
    fieldSelector: `involvedObject.name=${item.metadata.name},involvedObject.kind=${kind}`,
  }) as [any[] | null, any];

  if (!events?.length) return null;

  return (
    <SectionBox title="Events">
      <Table
        data={events}
        columns={[
          { header: 'Type', accessorFn: (e: any) => e.type ?? '-' },
          { header: 'Reason', accessorFn: (e: any) => e.reason ?? '-' },
          { header: 'Message', accessorFn: (e: any) => e.message ?? '-' },
          { header: 'Source', accessorFn: (e: any) => e.source?.component ?? '-' },
          {
            header: 'Age',
            accessorFn: (e: any) =>
              -new Date(e.lastOccurrence ?? e.metadata?.creationTimestamp).getTime(),
            Cell: ({ row: { original: e } }: any) => (
              <DateLabel
                date={e.lastOccurrence ?? e.metadata?.creationTimestamp}
                format="mini"
              />
            ),
          },
        ]}
      />
    </SectionBox>
  );
}

// ── Resource topology section ─────────────────────────────────────────────────

interface ResourceRef {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
}

interface XRTopologySectionProps {
  item: KubeObject;
  xrd: KubeObject;
  scope: XRScope;
}

function XRTopologySection({ item, xrd, scope }: XRTopologySectionProps) {
  // Child refs differ between v1 (LegacyCluster) and v2 XRDs
  const childRefs: ResourceRef[] =
    scope === 'LegacyCluster'
      ? (item.jsonData?.spec?.resourceRefs ?? [])
      : (item.jsonData?.spec?.crossplane?.resourceRefs ?? []);

  // Parent claim only exists for v1 LegacyCluster XRs
  const claimRef = scope === 'LegacyCluster' ? item.jsonData?.spec?.claimRef : null;
  const claimPlural: string | undefined = xrd.jsonData?.spec?.claimNames?.plural;

  if (!childRefs.length && !claimRef) return null;

  return (
    <SectionBox title="Resource Topology">
      {claimRef && (
        <Box mb={childRefs.length ? 3 : 0}>
          <Typography variant="subtitle2" gutterBottom>
            Parent Claim
          </Typography>
          <Box display="flex" gap={1} alignItems="center" pl={1}>
            <Typography variant="body2" color="textSecondary">
              {claimRef.kind}
            </Typography>
            {claimPlural && claimRef.namespace ? (
              <Link
                routeName="crossplane-claim-detail"
                params={{
                  plural: claimPlural,
                  namespace: claimRef.namespace,
                  name: claimRef.name,
                }}
              >
                {claimRef.name}
              </Link>
            ) : (
              <Typography variant="body2">{claimRef.name}</Typography>
            )}
            {claimRef.namespace && (
              <Typography variant="body2" color="textSecondary">
                ({claimRef.namespace})
              </Typography>
            )}
          </Box>
        </Box>
      )}
      {childRefs.length > 0 && (
        <>
          <Typography variant="subtitle2" gutterBottom>
            Composed Resources
          </Typography>
          <Table
            data={childRefs}
            columns={[
              { header: 'Kind', accessorKey: 'kind' },
              { header: 'Name', accessorKey: 'name' },
              { header: 'API Version', accessorKey: 'apiVersion' },
              { header: 'Namespace', accessorFn: (r: ResourceRef) => r.namespace ?? '-' },
            ]}
          />
        </>
      )}
    </SectionBox>
  );
}

// ── Inner component — always called with a resolved XRD ──────────────────────

interface XRDetailInnerProps {
  xrd: KubeObject;
  name: string;
  namespace?: string;
}

function XRDetailInner({ xrd, name, namespace }: XRDetailInnerProps) {
  const scope: XRScope = getXRScope(xrd);
  const DynClass = useMemo(() => makeXRClass(xrd), [xrd.metadata.uid]);
  const [item] = DynClass.useGet(name, namespace);

  const responsive = item ? getResponsiveCondition(item) : null;

  const extraInfo = item
    ? [
        { name: 'Ready', value: <ReadyStatus item={item} /> },
        { name: 'Synced', value: <SyncedStatus item={item} /> },
        ...(responsive
          ? [{ name: 'Responsive', value: responsive.status }]
          : []),
        { name: 'Scope', value: scope },
        { name: 'Composition', value: getCompositionRef(item, scope) },
        {
          name: 'Composition Revision',
          value:
            scope === 'LegacyCluster'
              ? (item.jsonData?.spec?.compositionRevisionRef?.name ?? '-')
              : (item.jsonData?.spec?.crossplane?.compositionRevisionRef?.name ?? '-'),
        },
      ]
    : [];

  const kind: string = xrd.jsonData?.spec?.names?.kind ?? '';

  return (
    <>
      <MainInfoSection resource={item} extraInfo={extraInfo} />
      {item && (
        <>
          <XRTopologySection item={item} xrd={xrd} scope={scope} />
          <ConditionsTable resource={item.jsonData} />
          <XREventsSection item={item} kind={kind} />
        </>
      )}
    </>
  );
}
