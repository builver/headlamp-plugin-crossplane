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
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ComposedResources } from '../components/ComposedResources';
import { ReadyStatus, SyncedStatus } from '../components/ConditionStatus';
import { PauseAction } from '../components/PauseAction';
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

// ── Inner component — always called with a resolved XRD ──────────────────────

interface XRDetailInnerProps {
  xrd: KubeObject;
  name: string;
  namespace?: string;
}

export function XRDetailInner({ xrd, name, namespace }: XRDetailInnerProps) {
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
        {
          name: 'Composition',
          value: (() => {
            const name = getCompositionRef(item, scope);
            return name !== '-'
              ? <Link routeName={`crossplane-composition-detail-${name}`}>{name}</Link>
              : '-';
          })(),
        },
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
      <MainInfoSection
        resource={item}
        extraInfo={extraInfo}
        actions={item ? [<PauseAction item={item} crd={xrd} />] : []}
      />
      {item && (
        <>
          <ConditionsTable resource={item.jsonData} />
          <SectionBox title="Composed Resources">
            <ComposedResources item={item} scope={scope} />
          </SectionBox>
          <XREventsSection item={item} kind={kind} />
        </>
      )}
    </>
  );
}
