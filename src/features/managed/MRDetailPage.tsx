import { Activity } from '@kinvolk/headlamp-plugin/lib';
import {
  ConditionsTable,
  CreateResourceButton,
  MainInfoSection,
  ResourceTable,
  SectionBox,
  SectionFilterHeader,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useFilterFunc } from '@kinvolk/headlamp-plugin/lib/Utils';
import { Link as MuiLink } from '@mui/material';
import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { linkSx } from '../../components/ActivityNameLink';
import { readyColumn, syncedColumn } from '../../components/columns';
import { ReadyStatus, SyncedStatus } from '../../components/ConditionStatus';
import { PauseAction } from '../../components/PauseAction';
import { makeMRClass, ManagedResourceDefinition } from '../../resources';
import { STUB_CLASS } from '../../resources/crdClassCache';

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
  const [items] = (DynClass ?? STUB_CLASS).useList() as [KubeObject[] | null, any];

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
      <ResourceTable.default
        data={items}
        filterFunction={filterFunction}
        enableRowActions
        columns={[
          {
            label: 'Name',
            getValue: (item: KubeObject) => item.metadata.name,
            render: (item: KubeObject) => {
              const launch = () => {
                const id = `crossplane-mr-${mrdName}-${item.metadata.namespace ?? ''}-${item.metadata.name}`;
                Activity.launch({
                  id,
                  title: `${kind} ${item.metadata.name}`,
                  hideTitleInHeader: true,
                  location: 'split-right',
                  cluster: item.cluster,
                  content: (
                    <MRDetailInner
                      mrdName={mrdName}
                      name={item.metadata.name}
                      namespace={item.metadata.namespace}
                    />
                  ),
                });
              };
              return (
                <MuiLink component="button" onClick={launch} sx={linkSx}>
                  {item.metadata.name}
                </MuiLink>
              );
            },
          },
          ...(isNamespaced ? ['namespace' as const] : []),
          readyColumn,
          syncedColumn,
          'age' as const,
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
  const [item] = (DynClass ?? STUB_CLASS).useGet(name, namespace) as [KubeObject | null, any];

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
