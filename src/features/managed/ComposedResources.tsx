import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { DateLabel, Link } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Box, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import { useMemo } from 'react';
import { ReadyStatus, SyncedStatus } from '../../components/ConditionStatus';
import { getGroupVersion } from '../../components/map/apiPaths';
import { ResourceRef } from '../../components/map/types';
import { XRScope } from '../../resources';
import { ConfigCRDInfo, getOrCreateClass } from '../../resources/crdClassCache';

interface RefMeta {
  ref: ResourceRef;
  resolvedNs?: string;
  builtinCls: any | null;
  crdInfo: ConfigCRDInfo | null;
}

function refKey(ref: ResourceRef): string {
  return `${ref.apiVersion}/${ref.kind}/${ref.namespace ?? ''}/${ref.name}`;
}

function buildRefMeta(
  ref: ResourceRef,
  scope: XRScope,
  xrNamespace: string | undefined,
  crds: KubeObject[],
): RefMeta {
  const resolvedNs =
    scope === 'Namespaced' ? (ref.namespace ?? xrNamespace) : ref.namespace;

  const builtinCls =
    Object.values(K8s.ResourceClasses).find(
      cls => (cls as any).kind === ref.kind && (cls as any).apiVersion === ref.apiVersion,
    ) ?? null;
  if (builtinCls) return { ref, resolvedNs, builtinCls, crdInfo: null };

  const [group, version] = getGroupVersion(ref.apiVersion);
  const crd = crds.find(
    c =>
      c.jsonData?.spec?.group === group &&
      c.jsonData?.spec?.names?.kind === ref.kind,
  );
  if (!crd) return { ref, resolvedNs, builtinCls: null, crdInfo: null };

  const spec = crd.jsonData?.spec ?? {};
  const versions = (spec.versions ?? [])
    .filter((v: any) => v.served !== false)
    .map((v: any) => ({ group, version: v.name }));
  const crdInfo: ConfigCRDInfo = {
    crdName: crd.metadata.name,
    group,
    kind: ref.kind,
    plural: spec.names?.plural ?? '',
    versions: versions.length ? versions : [{ group, version }],
    isNamespaced: spec.scope === 'Namespaced',
  };
  return { ref, resolvedNs, builtinCls: null, crdInfo };
}

interface ComposedResourcesProps {
  item: KubeObject;
  scope: XRScope;
}

export function ComposedResources({ item, scope }: ComposedResourcesProps) {
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList() as [
    KubeObject[] | null,
    any,
  ];

  const refMetas = useMemo(() => {
    const refs: ResourceRef[] =
      scope === 'LegacyCluster'
        ? (item.jsonData?.spec?.resourceRefs ?? [])
        : (item.jsonData?.spec?.crossplane?.resourceRefs ?? []);
    return refs.map(ref =>
      buildRefMeta(ref, scope, item.metadata.namespace, crds ?? []),
    );
  }, [item.jsonData, scope, crds]);

  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Namespace</TableCell>
            <TableCell>Kind</TableCell>
            <TableCell>Ready</TableCell>
            <TableCell>Synced</TableCell>
            <TableCell>Age</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {refMetas.map(meta => {
            const key = refKey(meta.ref);
            if (meta.builtinCls) return <BuiltinRow key={key} meta={meta} />;
            if (meta.crdInfo) return <CustomRow key={key} meta={meta} />;
            return <UnresolvedRow key={key} meta={meta} />;
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

function BuiltinRow({ meta }: { meta: RefMeta }) {
  const [item] = meta.builtinCls!.useGet(meta.ref.name, meta.resolvedNs) as [
    KubeObject | null,
    any,
  ];
  return <RowCells meta={meta} item={item} kind="builtin" />;
}

function CustomRow({ meta }: { meta: RefMeta }) {
  const cls = getOrCreateClass(meta.crdInfo!);
  const [item] = cls.useGet(meta.ref.name, meta.resolvedNs) as [
    KubeObject | null,
    any,
  ];
  return <RowCells meta={meta} item={item} kind="custom" />;
}

function UnresolvedRow({ meta }: { meta: RefMeta }) {
  return <RowCells meta={meta} item={null} kind="unresolved" />;
}

function RowCells({
  meta,
  item,
  kind,
}: {
  meta: RefMeta;
  item: KubeObject | null;
  kind: 'builtin' | 'custom' | 'unresolved';
}) {
  const jsonData = item?.jsonData;
  return (
    <TableRow hover>
      <TableCell>
        <NameLink meta={meta} kind={kind} />
      </TableCell>
      <TableCell>
        {meta.resolvedNs ? (
          <Link routeName="namespace" params={{ name: meta.resolvedNs }}>
            {meta.resolvedNs}
          </Link>
        ) : null}
      </TableCell>
      <TableCell>{meta.ref.kind}</TableCell>
      <TableCell>
        <ReadyStatus item={{ jsonData: jsonData ?? {} } as unknown as KubeObject} />
      </TableCell>
      <TableCell>
        <SyncedStatus item={{ jsonData: jsonData ?? {} } as unknown as KubeObject} />
      </TableCell>
      <TableCell>
        {jsonData?.metadata?.creationTimestamp ? (
          <DateLabel date={jsonData.metadata.creationTimestamp} format="mini" />
        ) : null}
      </TableCell>
    </TableRow>
  );
}

function NameLink({
  meta,
  kind,
}: {
  meta: RefMeta;
  kind: 'builtin' | 'custom' | 'unresolved';
}) {
  if (kind === 'builtin') {
    return (
      <Link
        routeName={meta.ref.kind}
        params={{ name: meta.ref.name, namespace: meta.resolvedNs || '-' }}
      >
        {meta.ref.name}
      </Link>
    );
  }
  if (kind === 'custom' && meta.crdInfo) {
    const crdFullName = meta.crdInfo.group
      ? `${meta.crdInfo.plural}.${meta.crdInfo.group}`
      : meta.crdInfo.plural;
    return (
      <Link
        routeName="customresource"
        params={{
          crName: meta.ref.name,
          crd: crdFullName,
          namespace: meta.resolvedNs || '-',
        }}
      >
        {meta.ref.name}
      </Link>
    );
  }
  return <>{meta.ref.name}</>;
}
