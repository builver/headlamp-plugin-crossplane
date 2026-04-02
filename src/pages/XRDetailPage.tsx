import {
  ActionButton,
  ConditionsTable,
  DateLabel,
  MainInfoSection,
  SectionBox,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import Event from '@kinvolk/headlamp-plugin/lib/K8s/event';
import { useMemo, useState } from 'react';
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

// ── Pause / unpause action ────────────────────────────────────────────────────

interface PauseActionProps {
  item: KubeObject;
  xrd: KubeObject;
  scope: XRScope;
}

function PauseAction({ item, xrd, scope }: PauseActionProps) {
  const isPaused = item.metadata?.annotations?.['crossplane.io/paused'] === 'true';
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    const spec = xrd.jsonData?.spec;
    const versions: any[] = (spec?.versions ?? []).filter((v: any) => v.served !== false);
    const version = versions[0]?.name;
    const group = spec?.group;
    const plural = spec?.names?.plural;
    const { name, namespace } = item.metadata;

    const basePath = `/apis/${group}/${version}`;
    const path =
      scope === 'Namespaced' && namespace
        ? `${basePath}/namespaces/${namespace}/${plural}/${name}`
        : `${basePath}/${plural}/${name}`;

    const patch = {
      metadata: {
        annotations: { 'crossplane.io/paused': isPaused ? null : 'true' },
      },
    };

    setLoading(true);
    try {
      await ApiProxy.request(path, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/merge-patch+json' },
        body: JSON.stringify(patch),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ActionButton
      description={isPaused ? 'Resume reconciliation' : 'Pause reconciliation'}
      icon={isPaused ? 'mdi:play' : 'mdi:pause'}
      onClick={handleClick}
      iconButtonProps={{ disabled: loading }}
    />
  );
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
      <MainInfoSection
        resource={item}
        extraInfo={extraInfo}
        actions={item ? [<PauseAction item={item} xrd={xrd} scope={scope} />] : []}
      />
      {item && (
        <>
          <ConditionsTable resource={item.jsonData} />
          <XREventsSection item={item} kind={kind} />
        </>
      )}
    </>
  );
}
