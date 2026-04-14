import {
  ConditionsTable,
  CreateResourceButton,
  DateLabel,
  Link,
  MainInfoSection,
  SectionBox,
  SectionFilterHeader,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { ReadyStatus, SyncedStatus } from '../components/ConditionStatus';
import { PauseAction } from '../components/PauseAction';
import { makeMRClass,ManagedResourceDefinition } from '../resources';

// ── MR list ───────────────────────────────────────────────────────────────────

export function MRListPage() {
  const { mrdName } = useParams<{ mrdName: string }>();
  const [mrds] = ManagedResourceDefinition.useList();
  const filterFunction = useFilterFunc();

  const mrd = mrds?.find(m => m.metadata.name === mrdName) ?? null;
  const isNamespaced = mrd?.jsonData?.spec?.scope === 'Namespaced';

  const DynClass = useMemo(() => {
    if (!mrd) return null;
    const cls = makeMRClass(mrd);
    const orig = cls.getBaseObject.bind(cls);
    cls.getBaseObject = () => ({
      ...orig(),
      spec: {
        providerConfigRef: isNamespaced
          ? { name: '', kind: 'ClusterProviderConfig' }
          : { name: '' },
        forProvider: {},
      },
    });
    return cls;
  }, [mrd?.metadata.uid, isNamespaced]);
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
    <SectionBox
      title={
        <SectionFilterHeader
          title={kind}
          titleSideActions={DynClass ? [<CreateResourceButton resourceClass={DynClass} resourceName={kind} />] : []}
        />
      }
    >
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

// ── MR detail ─────────────────────────────────────────────────────────────────

export function MRDetailClusterPage() {
  const { mrdName, name } = useParams<{ mrdName: string; name: string }>();
  return <MRDetailInner mrdName={mrdName} name={name} />;
}

export function MRDetailNamespacedPage() {
  const { mrdName, namespace, name } = useParams<{
    mrdName: string;
    namespace: string;
    name: string;
  }>();
  return <MRDetailInner mrdName={mrdName} name={name} namespace={namespace} />;
}

interface MRDetailInnerProps {
  mrdName: string;
  name: string;
  namespace?: string;
}

export function MRDetailInner({ mrdName, name, namespace }: MRDetailInnerProps) {
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
        actions={item && mrd ? [<PauseAction item={item} crd={mrd} />] : []}
      />
      {item && <ConditionsTable resource={item.jsonData} />}
    </>
  );
}
