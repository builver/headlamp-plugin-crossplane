import {
  ActionButton,
  ConditionsTable,
  DateLabel,
  Link,
  MainInfoSection,
  SectionBox,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ReadyStatus, SyncedStatus } from '../components/ConditionStatus';
import { ManagedResourceDefinition, makeMRClass } from '../resources';

// ── Pause / resume action ─────────────────────────────────────────────────────

interface PauseActionProps {
  item: KubeObject;
  mrd: KubeObject;
}

function PauseAction({ item, mrd }: PauseActionProps) {
  const isPaused = item.metadata?.annotations?.['crossplane.io/paused'] === 'true';
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    const spec = mrd.jsonData?.spec;
    const group: string = spec?.group ?? '';
    const versions: any[] = (spec?.versions ?? []).filter((v: any) => v.served !== false);
    const version: string = versions[0]?.name ?? 'v1';
    const plural: string = spec?.names?.plural ?? '';
    const { name, namespace } = item.metadata;

    const basePath = `/apis/${group}/${version}`;
    const path = namespace
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

// ── MR instance list ──────────────────────────────────────────────────────────

export function MRInstanceListPage() {
  const { mrdName } = useParams<{ mrdName: string }>();
  const [mrds] = ManagedResourceDefinition.useList();
  const filterFunction = useFilterFunc();

  const mrd = mrds?.find(m => m.metadata.name === mrdName) ?? null;
  const isNamespaced = mrd?.jsonData?.spec?.scope === 'Namespaced';

  const DynClass = useMemo(() => (mrd ? makeMRClass(mrd) : null), [mrd?.metadata.uid]);
  const [items] = (DynClass?.useList() ?? [null]) as [KubeObject[] | null, any];

  const kind: string = mrd?.jsonData?.spec?.names?.kind ?? mrdName;

  if (!mrds) return <SectionBox title="Managed Resources"><p>Loading…</p></SectionBox>;
  if (!mrd)
    return (
      <SectionBox title="Managed Resources">
        <p>No managed resource definition found for "{mrdName}".</p>
      </SectionBox>
    );

  return (
    <SectionBox title={kind}>
      <Table
        data={items}
        loading={items === null}
        filterFunction={filterFunction}
        columns={[
          {
            header: 'Name',
            accessorKey: 'metadata.name',
            Cell: ({ row: { original: item } }: any) => {
              const params = isNamespaced
                ? { mrdName, namespace: item.metadata.namespace, name: item.metadata.name }
                : { mrdName, name: item.metadata.name };
              const routeName = isNamespaced
                ? 'crossplane-mr-detail-namespaced'
                : 'crossplane-mr-detail-cluster';
              return <Link routeName={routeName} params={params}>{item.metadata.name}</Link>;
            },
          },
          ...(isNamespaced
            ? [{ header: 'Namespace', accessorKey: 'metadata.namespace' }]
            : []),
          {
            header: 'Ready',
            accessorFn: (item: KubeObject) => item,
            Cell: ({ row: { original: item } }: any) => <ReadyStatus item={item} />,
          },
          {
            header: 'Synced',
            accessorFn: (item: KubeObject) => item,
            Cell: ({ row: { original: item } }: any) => <SyncedStatus item={item} />,
          },
          {
            header: 'Age',
            accessorFn: (item: KubeObject) =>
              -new Date(item.metadata.creationTimestamp).getTime(),
            Cell: ({ row: { original: item } }: any) => (
              <DateLabel date={item.metadata.creationTimestamp} format="mini" />
            ),
          },
        ]}
      />
    </SectionBox>
  );
}

// ── MR instance detail ────────────────────────────────────────────────────────

export function MRInstanceDetailClusterPage() {
  const { mrdName, name } = useParams<{ mrdName: string; name: string }>();
  return <MRInstanceDetailInner mrdName={mrdName} name={name} />;
}

export function MRInstanceDetailNamespacedPage() {
  const { mrdName, namespace, name } = useParams<{
    mrdName: string;
    namespace: string;
    name: string;
  }>();
  return <MRInstanceDetailInner mrdName={mrdName} name={name} namespace={namespace} />;
}

interface MRInstanceDetailInnerProps {
  mrdName: string;
  name: string;
  namespace?: string;
}

export function MRInstanceDetailInner({ mrdName, name, namespace }: MRInstanceDetailInnerProps) {
  const [mrds] = ManagedResourceDefinition.useList();
  const mrd = mrds?.find(m => m.metadata.name === mrdName) ?? null;

  const DynClass = useMemo(() => (mrd ? makeMRClass(mrd) : null), [mrd?.metadata.uid]);
  const [item] = (DynClass?.useGet(name, namespace) ?? [null]) as [KubeObject | null, any];

  const extraInfo = item
    ? [
        { name: 'Ready', value: <ReadyStatus item={item} /> },
        { name: 'Synced', value: <SyncedStatus item={item} /> },
      ]
    : [];

  return (
    <>
      <MainInfoSection
        resource={item}
        extraInfo={extraInfo}
        actions={item && mrd ? [<PauseAction item={item} mrd={mrd} />] : []}
      />
      {item && <ConditionsTable resource={item.jsonData} />}
    </>
  );
}
