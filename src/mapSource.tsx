import { Icon } from '@iconify/react';
import { ApiProxy, K8s, registerMapSource } from '@kinvolk/headlamp-plugin/lib';
import {
  ConditionsTable,
  Link,
  MainInfoSection,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { makeCustomResourceClass } from '@kinvolk/headlamp-plugin/lib/lib/k8s/crd';
import { useEffect, useMemo, useState } from 'react';
import { ReadyStatus, SyncedStatus } from './components/ConditionStatus';
import {
  CompositeResourceDefinition,
  getCompositionRef,
  getResponsiveCondition,
  getXRScope,
  makeXRClass,
  XRScope,
} from './resources';

// ── Types ────────────────────────────────────────────────────────────────────

interface ResourceRef {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
}

// ── Detail components ─────────────────────────────────────────────────────────

/**
 * Detail panel for XR nodes — shown when the user clicks an XR in the Map.
 * Uses the kubeObject already stored on the node; looks up the XRD for scope /
 * composition info.
 */
function XRMapDetail({ node }: { node: any }) {
  const xr = node.kubeObject as KubeObject;
  const [xrds] = CompositeResourceDefinition.useList();

  const kind = xr.jsonData?.kind as string | undefined;
  const xrd = xrds?.find(x => x.jsonData?.spec?.names?.kind === kind) ?? null;
  const scope: XRScope = xrd ? getXRScope(xrd) : 'LegacyCluster';
  const responsive = getResponsiveCondition(xr);

  const extraInfo = [
    { name: 'Ready', value: <ReadyStatus item={xr} /> },
    { name: 'Synced', value: <SyncedStatus item={xr} /> },
    ...(responsive ? [{ name: 'Responsive', value: responsive.status }] : []),
    { name: 'Scope', value: scope },
    ...(xrd ? [{ name: 'Composition', value: getCompositionRef(xr, scope) }] : []),
  ];

  return (
    <>
      <MainInfoSection resource={xr} extraInfo={extraInfo} />
      <ConditionsTable resource={xr.jsonData} />
    </>
  );
}

/**
 * Inner component for child resource detail — always mounted so hooks are
 * called unconditionally. Fetches the actual managed resource via a dynamic
 * class built from the CRD plural name.
 */
function FetchedResourceDetail({
  apiGroup,
  version,
  kind,
  plural,
  name,
  namespace,
}: {
  apiGroup: string;
  version: string;
  kind: string;
  plural: string;
  name: string;
  namespace?: string;
}) {
  const DynClass = useMemo(
    () =>
      makeCustomResourceClass({
        apiInfo: [{ group: apiGroup, version }],
        kind,
        pluralName: plural,
        singularName: kind.toLowerCase(),
        isNamespaced: !!namespace,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [apiGroup, version, kind, plural]
  );

  const [item] = DynClass.useGet(name, namespace);

  if (!item) return <SectionBox title={kind}><p>Loading…</p></SectionBox>;

  return (
    <>
      <MainInfoSection resource={item} />
      <ConditionsTable resource={item.jsonData} />
    </>
  );
}

/**
 * Detail panel for child (composed) resource nodes.
 * Looks up the CRD to get the plural name, then renders FetchedResourceDetail.
 * Falls back to a static NameValueTable while the CRD list is loading or when
 * the CRD is not found (e.g. resource deleted or RBAC restricted).
 */
function ChildResourceMapDetail({ node }: { node: any }) {
  const { apiVersion, kind, name, namespace } = (node.data ?? {}) as ResourceRef;

  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();

  const parts = (apiVersion ?? '').split('/');
  const apiGroup = parts.length === 2 ? parts[0] : '';
  const version = parts.length === 2 ? parts[1] : parts[0];

  const plural = crds?.find(
    crd =>
      crd.jsonData?.spec?.names?.kind === kind &&
      crd.jsonData?.spec?.group === apiGroup
  )?.jsonData?.spec?.names?.plural as string | undefined;

  if (!plural) {
    return (
      <SectionBox title={kind ?? 'Composed Resource'}>
        <NameValueTable
          rows={[
            { name: 'Name', value: name ?? '-' },
            { name: 'Kind', value: kind ?? '-' },
            { name: 'API Version', value: apiVersion ?? '-' },
            { name: 'Namespace', value: namespace ?? '(cluster-scoped)' },
          ]}
        />
      </SectionBox>
    );
  }

  return (
    <FetchedResourceDetail
      apiGroup={apiGroup}
      version={version}
      kind={kind}
      plural={plural}
      name={name}
      namespace={namespace}
    />
  );
}

/**
 * Detail panel for claim (parent) nodes on LegacyCluster XRs.
 * Shows static metadata and links to the Claims detail page when the claim
 * plural can be resolved from the XRDs list.
 */
function ClaimMapDetail({ node }: { node: any }) {
  const { kind, name, namespace } = (node.data ?? {}) as {
    kind?: string;
    name: string;
    namespace?: string;
  };

  const [xrds] = CompositeResourceDefinition.useList();

  // Find the XRD whose claimNames.kind matches this claim's kind.
  const claimPlural = xrds?.find(
    xrd => xrd.jsonData?.spec?.claimNames?.kind === kind
  )?.jsonData?.spec?.claimNames?.plural as string | undefined;

  const nameRow = claimPlural && namespace
    ? {
        name: 'Name',
        value: (
          <Link
            routeName="crossplane-claim-detail"
            params={{ plural: claimPlural, namespace, name }}
          >
            {name}
          </Link>
        ),
      }
    : { name: 'Name', value: name };

  return (
    <SectionBox title={kind ?? 'Claim'}>
      <NameValueTable
        rows={[
          nameRow,
          { name: 'Kind', value: kind ?? '-' },
          { name: 'Namespace', value: namespace ?? '-' },
        ]}
      />
    </SectionBox>
  );
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Known Kubernetes native resource kinds that have owner-reference children. */
const OWNER_REF_CHILDREN: Record<string, Array<{ kind: string; apiVersion: string }>> = {
  Deployment:  [{ kind: 'ReplicaSet', apiVersion: 'apps/v1' }],
  ReplicaSet:  [{ kind: 'Pod',        apiVersion: 'v1' }],
  StatefulSet: [{ kind: 'Pod',        apiVersion: 'v1' }],
  DaemonSet:   [{ kind: 'Pod',        apiVersion: 'v1' }],
  Job:         [{ kind: 'Pod',        apiVersion: 'v1' }],
  CronJob:     [{ kind: 'Job',        apiVersion: 'batch/v1' }],
};

const MAX_DEPTH = 5;

/**
 * Hardcoded plural names for native K8s resources encountered during BFS
 * expansion (owner-ref children). CRD-based resources use the CRD list instead.
 */
const NATIVE_PLURALS: Record<string, string> = {
  'apps/Deployment':              'deployments',
  'apps/ReplicaSet':              'replicasets',
  'apps/StatefulSet':             'statefulsets',
  'apps/DaemonSet':               'daemonsets',
  'batch/Job':                    'jobs',
  'batch/CronJob':                'cronjobs',
  '/Pod':                         'pods',
  '/Service':                     'services',
  '/PersistentVolumeClaim':       'persistentvolumeclaims',
  '/ConfigMap':                   'configmaps',
  '/Secret':                      'secrets',
  '/ServiceAccount':              'serviceaccounts',
};

// ── API path helpers ───────────────────────────────────────────────────────────

function getGroupVersion(apiVersion: string): [string, string] {
  const parts = apiVersion.split('/');
  return parts.length === 2 ? [parts[0], parts[1]] : ['', parts[0]];
}

function lookupPlural(apiVersion: string, kind: string, crds: KubeObject[] | null): string | undefined {
  const [group] = getGroupVersion(apiVersion);
  const key = `${group}/${kind}`;
  if (NATIVE_PLURALS[key]) return NATIVE_PLURALS[key];
  return crds?.find(
    crd => crd.jsonData?.spec?.names?.kind === kind && crd.jsonData?.spec?.group === group
  )?.jsonData?.spec?.names?.plural as string | undefined;
}

function buildGetPath(apiVersion: string, plural: string, name: string, namespace?: string): string {
  const [group, version] = getGroupVersion(apiVersion);
  const base = group ? `/apis/${group}/${version}` : `/api/${version}`;
  return namespace
    ? `${base}/namespaces/${namespace}/${plural}/${name}`
    : `${base}/${plural}/${name}`;
}

function buildListPath(apiVersion: string, plural: string, namespace?: string): string {
  const [group, version] = getGroupVersion(apiVersion);
  const base = group ? `/apis/${group}/${version}` : `/api/${version}`;
  return namespace ? `${base}/namespaces/${namespace}/${plural}` : `${base}/${plural}`;
}

// ── Graph node factory ────────────────────────────────────────────────────────

function makeChildNode(
  id: string,
  apiVersion: string,
  kind: string,
  name: string,
  namespace: string | undefined,
  icon = 'mdi:cube-outline',
): object {
  return {
    id,
    label: name,
    subtitle: namespace ? `${kind} · ${namespace}` : kind,
    icon: <Icon icon={icon} width="100%" height="100%" />,
    data: { apiVersion, kind, name, namespace },
    detailsComponent: ChildResourceMapDetail,
  };
}

// ── BFS expansion types ────────────────────────────────────────────────────────

type QueueEntry =
  | {
      type: 'get';
      apiVersion: string;
      kind: string;
      name: string;
      namespace?: string;
      parentNodeId: string;
      depth: number;
      isXR: boolean;
    }
  | {
      type: 'list-by-owner';
      apiVersion: string;
      kind: string;
      namespace: string;
      ownerUid: string;
      parentNodeId: string;
      depth: number;
    };

interface ExpandContext {
  xrdGroupSet: Set<string>;
  claimKindSet: Set<string>;
  xrdScopeMap: Map<string, XRScope>;
  crds: KubeObject[] | null;
  nodeMap: Map<string, object>;
  edgeSet: Set<string>;
  edges: Array<{ id: string; source: string; target: string }>;
  visited: Set<string>;
  signal: AbortSignal;
}

function addEdge(ctx: ExpandContext, source: string, target: string) {
  const id = `${source}-->${target}`;
  if (!ctx.edgeSet.has(id)) {
    ctx.edgeSet.add(id);
    ctx.edges.push({ id, source, target });
  }
}

// ── BFS entry processors ──────────────────────────────────────────────────────

async function processGetEntry(
  entry: Extract<QueueEntry, { type: 'get' }>,
  ctx: ExpandContext,
): Promise<QueueEntry[]> {
  const { apiVersion, kind, name, namespace, parentNodeId, depth, isXR } = entry;
  const plural = lookupPlural(apiVersion, kind, ctx.crds);
  const compositeId = `${apiVersion}::${kind}::${namespace ?? ''}::${name}`;

  if (isXR) {
    if (!plural) {
      if (!ctx.nodeMap.has(compositeId)) {
        ctx.nodeMap.set(compositeId, makeChildNode(compositeId, apiVersion, kind, name, namespace, 'mdi:layers-outline'));
        addEdge(ctx, parentNodeId, compositeId);
      }
      return [];
    }

    const path = buildGetPath(apiVersion, plural, name, namespace);
    let rawJson: any;
    try {
      rawJson = await ApiProxy.request(path);
    } catch {
      if (!ctx.nodeMap.has(compositeId)) {
        ctx.nodeMap.set(compositeId, makeChildNode(compositeId, apiVersion, kind, name, namespace, 'mdi:layers-outline'));
        addEdge(ctx, parentNodeId, compositeId);
      }
      return [];
    }
    if (ctx.signal.aborted) return [];

    const uid: string = rawJson?.metadata?.uid ?? compositeId;

    if (ctx.visited.has(uid)) {
      addEdge(ctx, parentNodeId, uid);
      return [];
    }
    ctx.visited.add(uid);

    ctx.nodeMap.set(uid, makeChildNode(uid, apiVersion, kind, name, namespace, 'mdi:layers-outline'));
    addEdge(ctx, parentNodeId, uid);

    if (depth >= MAX_DEPTH) return [];

    const [group] = getGroupVersion(apiVersion);
    const childScope = ctx.xrdScopeMap.get(`${group}/${kind}`) ?? 'LegacyCluster';
    const xrNamespace = rawJson?.metadata?.namespace as string | undefined;
    const childRefs: ResourceRef[] =
      childScope === 'LegacyCluster'
        ? (rawJson?.spec?.resourceRefs ?? [])
        : (rawJson?.spec?.crossplane?.resourceRefs ?? []);

    const next: QueueEntry[] = [];
    for (const ref of childRefs) {
      const resolvedNs =
        childScope === 'Namespaced' ? (ref.namespace ?? xrNamespace) : ref.namespace;
      const [refGroup] = getGroupVersion(ref.apiVersion);
      if (ctx.claimKindSet.has(`${refGroup}/${ref.kind}`)) continue;
      const isChildXR = ctx.xrdGroupSet.has(`${refGroup}/${ref.kind}`);
      next.push({
        type: 'get',
        apiVersion: ref.apiVersion,
        kind: ref.kind,
        name: ref.name,
        namespace: resolvedNs,
        parentNodeId: uid,
        depth: depth + 1,
        isXR: isChildXR,
      });
    }
    return next;
  }

  // ── Managed / native resource ───────────────────────────────────────────────
  if (ctx.visited.has(compositeId)) {
    addEdge(ctx, parentNodeId, compositeId);
    return [];
  }
  ctx.visited.add(compositeId);
  ctx.nodeMap.set(compositeId, makeChildNode(compositeId, apiVersion, kind, name, namespace));
  addEdge(ctx, parentNodeId, compositeId);

  if (depth >= MAX_DEPTH) return [];

  const ownerChildren = OWNER_REF_CHILDREN[kind];
  if (!ownerChildren || !namespace || !plural) return [];

  // Fetch to get UID for owner-reference filtering
  const path = buildGetPath(apiVersion, plural, name, namespace);
  let rawJson: any;
  try {
    rawJson = await ApiProxy.request(path);
  } catch {
    return [];
  }
  if (ctx.signal.aborted) return [];

  const uid: string | undefined = rawJson?.metadata?.uid;
  if (!uid) return [];

  return ownerChildren.map(child => ({
    type: 'list-by-owner' as const,
    apiVersion: child.apiVersion,
    kind: child.kind,
    namespace,
    ownerUid: uid,
    parentNodeId: compositeId,
    depth: depth + 1,
  }));
}

async function processListByOwnerEntry(
  entry: Extract<QueueEntry, { type: 'list-by-owner' }>,
  ctx: ExpandContext,
): Promise<QueueEntry[]> {
  const { apiVersion, kind, namespace, ownerUid, parentNodeId, depth } = entry;
  const plural = lookupPlural(apiVersion, kind, ctx.crds);
  if (!plural) return [];

  const path = buildListPath(apiVersion, plural, namespace);
  let response: any;
  try {
    response = await ApiProxy.request(path);
  } catch {
    return [];
  }
  if (ctx.signal.aborted) return [];

  const items: any[] = response?.items ?? [];
  const owned = items.filter((item: any) =>
    item.metadata?.ownerReferences?.some((ref: any) => ref.uid === ownerUid)
  );

  const next: QueueEntry[] = [];
  for (const item of owned) {
    const name = item.metadata?.name as string | undefined;
    if (!name) continue;
    const compositeId = `${apiVersion}::${kind}::${namespace}::${name}`;

    if (ctx.visited.has(compositeId)) {
      addEdge(ctx, parentNodeId, compositeId);
      continue;
    }
    ctx.visited.add(compositeId);
    ctx.nodeMap.set(compositeId, makeChildNode(compositeId, apiVersion, kind, name, namespace));
    addEdge(ctx, parentNodeId, compositeId);

    if (depth >= MAX_DEPTH) continue;

    const childUid: string | undefined = item.metadata?.uid;
    const ownerChildren = OWNER_REF_CHILDREN[kind];
    if (ownerChildren && childUid) {
      for (const child of ownerChildren) {
        next.push({
          type: 'list-by-owner',
          apiVersion: child.apiVersion,
          kind: child.kind,
          namespace,
          ownerUid: childUid,
          parentNodeId: compositeId,
          depth: depth + 1,
        });
      }
    }
  }

  return next;
}

// ── Main async expansion ───────────────────────────────────────────────────────

interface GraphState {
  nodes: object[];
  edges: Array<{ id: string; source: string; target: string }>;
}

async function expandGraphAsync(
  items: KubeObject[],
  scope: XRScope,
  xrdGroupSet: Set<string>,
  claimKindSet: Set<string>,
  xrdScopeMap: Map<string, XRScope>,
  crds: KubeObject[] | null,
  signal: AbortSignal,
  onUpdate: (state: GraphState) => void,
): Promise<void> {
  const ctx: ExpandContext = {
    xrdGroupSet,
    claimKindSet,
    xrdScopeMap,
    crds,
    nodeMap: new Map(),
    edgeSet: new Set(),
    edges: [],
    visited: new Set(),
    signal,
  };

  let queue: QueueEntry[] = [];

  // ── Wave 0: seed from useList items (no fetch needed) ──────────────────────
  for (const xr of items) {
    const xrUid = xr.metadata.uid;
    if (ctx.visited.has(xrUid)) continue;
    ctx.visited.add(xrUid);

    ctx.nodeMap.set(xrUid, {
      id: xrUid,
      kubeObject: xr,
      weight: 2000,
      detailsComponent: XRMapDetail,
    });

    const xrNamespace = xr.metadata.namespace as string | undefined;

    // Claim node (LegacyCluster only)
    const claimRef: { kind?: string; name: string; namespace?: string } | null =
      scope === 'LegacyCluster' ? (xr.jsonData?.spec?.claimRef ?? null) : null;

    if (claimRef?.name) {
      const claimId = `Claim::${claimRef.namespace ?? ''}::${claimRef.name}`;
      if (!ctx.nodeMap.has(claimId)) {
        ctx.nodeMap.set(claimId, {
          id: claimId,
          label: claimRef.name,
          subtitle: claimRef.namespace
            ? `${claimRef.kind ?? 'Claim'} · ${claimRef.namespace}`
            : (claimRef.kind ?? 'Claim'),
          icon: <Icon icon="mdi:inbox-outline" width="100%" height="100%" />,
          data: { kind: claimRef.kind, name: claimRef.name, namespace: claimRef.namespace },
          detailsComponent: ClaimMapDetail,
        });
      }
      addEdge(ctx, claimId, xrUid);
    }

    // Queue child refs
    const childRefs: ResourceRef[] =
      scope === 'LegacyCluster'
        ? (xr.jsonData?.spec?.resourceRefs ?? [])
        : (xr.jsonData?.spec?.crossplane?.resourceRefs ?? []);

    for (const ref of childRefs) {
      const resolvedNs =
        scope === 'Namespaced' ? (ref.namespace ?? xrNamespace) : ref.namespace;
      const [refGroup] = getGroupVersion(ref.apiVersion);
      if (claimKindSet.has(`${refGroup}/${ref.kind}`)) continue;
      const isChildXR = xrdGroupSet.has(`${refGroup}/${ref.kind}`);
      queue.push({
        type: 'get',
        apiVersion: ref.apiVersion,
        kind: ref.kind,
        name: ref.name,
        namespace: resolvedNs,
        parentNodeId: xrUid,
        depth: 1,
        isXR: isChildXR,
      });
    }
  }

  onUpdate({ nodes: [...ctx.nodeMap.values()], edges: [...ctx.edges] });

  // ── BFS waves ──────────────────────────────────────────────────────────────
  while (queue.length > 0 && !signal.aborted) {
    const wave = queue;
    queue = [];

    const results = await Promise.allSettled(
      wave.map(entry => {
        if (entry.type === 'get') return processGetEntry(entry, ctx);
        return processListByOwnerEntry(entry, ctx);
      })
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        queue.push(...result.value);
      }
    }

    if (!signal.aborted) {
      onUpdate({ nodes: [...ctx.nodeMap.values()], edges: [...ctx.edges] });
    }
  }
}

// ── Map source registration ───────────────────────────────────────────────────

export function registerCrossplaneMapSource(xrds: KubeObject[]): void {
  // Build lookup structures from XRDs
  const xrdGroupSet = new Set<string>();
  const claimKindSet = new Set<string>();
  const xrdScopeMap = new Map<string, XRScope>();

  for (const xrd of xrds) {
    const group: string = xrd.jsonData?.spec?.group ?? '';
    const kind: string = xrd.jsonData?.spec?.names?.kind ?? '';
    if (group && kind) {
      const key = `${group}/${kind}`;
      xrdGroupSet.add(key);
      xrdScopeMap.set(key, getXRScope(xrd));
    }
    const claimKind: string | undefined = xrd.jsonData?.spec?.claimNames?.kind;
    if (group && claimKind) {
      claimKindSet.add(`${group}/${claimKind}`);
    }
  }

  const subSources = xrds.map(xrd => {
    const scope = getXRScope(xrd);
    const DynClass = makeXRClass(xrd);
    const kind = (xrd.jsonData?.spec?.names?.kind as string | undefined) ?? xrd.metadata.name;
    const plural = (xrd.jsonData?.spec?.names?.plural as string | undefined) ?? xrd.metadata.name;

    return {
      id: `crossplane-xr-${plural}`,
      label: kind,
      icon: <Icon icon="mdi:layers-outline" width="100%" height="100%" />,
      useData() {
        const [graph, setGraph] = useState<GraphState | null>(null);
        const [items] = DynClass.useList();
        const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();

        useEffect(() => {
          if (!items) return;
          const abort = new AbortController();
          setGraph(null);

          expandGraphAsync(
            items,
            scope,
            xrdGroupSet,
            claimKindSet,
            xrdScopeMap,
            crds ?? null,
            abort.signal,
            setGraph,
          );

          return () => abort.abort();
          // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [items, crds]);

        return graph;
      },
    };
  });

  registerMapSource({
    id: 'crossplane',
    label: 'Crossplane',
    icon: <Icon icon="crossplane:color" width="100%" height="100%" />,
    sources: subSources,
  } as any);
}
