import { Icon } from '@iconify/react';
import { ApiProxy, K8s, registerKubeObjectGlance, registerMapSource } from '@kinvolk/headlamp-plugin/lib';
import {
  Link,
  NameValueTable,
  SectionBox,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Box } from '@mui/material';
import { useEffect, useState } from 'react';
import { HealthyStatus, InstalledStatus, RevisionHealthyStatus, RuntimeHealthyStatus } from './components/ConditionStatus';
import { FunctionDetailInner } from './pages/FunctionListPage';
import { MRDetailInner } from './pages/MRDetailPage';
import { ProviderDetailInner } from './pages/ProviderListPage';
import { XRDetailInner } from './pages/XRDetailPage';
import {
  CompositeResourceDefinition,
  CrossplaneFunction,
  FunctionRevision,
  getXRScope,
  makeXRClass,
  ManagedResourceDefinition,
  Provider,
  ProviderRevision,
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
 * Delegates to XRDetailInner so the map and the sidebar detail page are identical.
 */
function XRMapDetail({ node }: { node: any }) {
  const xr = node.kubeObject as KubeObject;
  const [xrds] = CompositeResourceDefinition.useList();

  const kind = xr.jsonData?.kind as string | undefined;
  const xrd = xrds?.find(x => x.jsonData?.spec?.names?.kind === kind) ?? null;

  if (!xrd) return null;

  return (
    <XRDetailInner
      xrd={xrd}
      name={xr.metadata.name}
      namespace={xr.metadata.namespace || undefined}
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

/**
 * Detail panel for managed resource nodes — shown when the user clicks an MR in the Map.
 * Looks up the MRD by kind+group and delegates to MRInstanceDetailInner.
 * Returns null for non-MR nodes (native K8s etc.) so the map uses its default.
 */
function MRMapDetail({ node }: { node: any }) {
  const mr = node.kubeObject;
  const kind: string = mr.kind ?? '';
  const apiVersion: string = mr.apiVersion ?? '';
  const name: string = mr.metadata?.name ?? '';
  const namespace: string | undefined = mr.metadata?.namespace;

  const [mrds] = ManagedResourceDefinition.useList();
  const [group] = getGroupVersion(apiVersion);

  const mrd =
    mrds?.find(
      m => m.jsonData?.spec?.names?.kind === kind && m.jsonData?.spec?.group === group
    ) ?? null;

  if (!mrd) return null;

  return <MRDetailInner mrdName={mrd.metadata.name} name={name} namespace={namespace} />;
}

function ProviderMapDetail({ node }: { node: any }) {
  const provider = node.kubeObject as KubeObject;
  return <ProviderDetailInner name={provider.metadata.name} />;
}

function FunctionMapDetail({ node }: { node: any }) {
  const fn = node.kubeObject as KubeObject;
  return <FunctionDetailInner name={fn.metadata.name} />;
}

function makeRevisionMapDetail(title: string) {
  return function RevisionMapDetail({ node }: { node: any }) {
    const rev = node.kubeObject as KubeObject;
    const spec = rev.jsonData?.spec ?? {};
    const status = rev.jsonData?.status ?? {};
    const depRow = (label: string, val: number | undefined) =>
      ({ name: label, value: val !== undefined ? String(val) : '-' });
    return (
      <SectionBox title={title}>
        <NameValueTable
          rows={[
            { name: 'Name', value: rev.metadata.name },
            { name: 'Revision #', value: spec.revision !== undefined ? String(spec.revision) : '-' },
            { name: 'Desired State', value: spec.desiredState ?? '-' },
            { name: 'Image', value: spec.image ?? '-' },
            { name: 'Resolved Image', value: status.resolvedImage ?? '-' },
            depRow('Found Dependencies', status.foundDependencies),
            depRow('Installed Dependencies', status.installedDependencies),
            depRow('Invalid Dependencies', status.invalidDependencies),
            { name: 'Runtime Healthy', value: <RuntimeHealthyStatus item={rev} /> },
            { name: 'Revision Healthy', value: <RevisionHealthyStatus item={rev} /> },
          ]}
        />
      </SectionBox>
    );
  };
}

const ProviderRevisionMapDetail = makeRevisionMapDetail('Provider Revision');
const FunctionRevisionMapDetail = makeRevisionMapDetail('Function Revision');

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

// Sentinel returned by _class() on all stubs — must not match any real class.
const NO_CLASS = { apiGroupName: '__stub__', apiName: '__stub__', kind: '__stub__' };

/**
 * Minimal KubeObject-like stub for non-XR child nodes (native K8s + CRDs).
 * KubeObjectDetails only needs kind/metadata/cluster to route to the right
 * detail component, which then re-fetches the resource itself.
 */
function makeKubeObjectLike(apiVersion: string, kind: string, name: string, namespace?: string): any {
  return {
    kind,
    apiVersion,
    metadata: { name, namespace },
    cluster: undefined,
    _class: () => NO_CLASS,
    getName: () => name,
    getNamespace: () => namespace,
  };
}

/**
 * Rich KubeObject-like wrapper built from already-fetched raw JSON.
 * Used for sub-XR nodes so XRMapDetail can read conditions, resourceRefs, etc.
 */
function makeXRKubeObjectFromJson(rawJson: any): any {
  const name: string = rawJson?.metadata?.name ?? '';
  const namespace: string | undefined = rawJson?.metadata?.namespace;
  return {
    kind: rawJson?.kind,
    apiVersion: rawJson?.apiVersion,
    metadata: rawJson?.metadata ?? { name, namespace },
    jsonData: rawJson,
    cluster: undefined,
    _class: () => NO_CLASS,
    getName: () => name,
    getNamespace: () => namespace,
  };
}

function findCrdName(apiVersion: string, kind: string, crds: KubeObject[] | null): string | undefined {
  if (!crds) return undefined;
  const [group] = getGroupVersion(apiVersion);
  const crd = crds.find(
    c => c.jsonData?.spec?.names?.kind === kind && c.jsonData?.spec?.group === group
  );
  // KubeObjectDetails passes this value as the `crd` prop to CustomResourceDetails,
  // which treats it as a CRD name string passed to CustomResourceDefinition.useGet().
  return crd?.metadata?.name as string | undefined;
}

function makeChildNode(
  id: string,
  apiVersion: string,
  kind: string,
  name: string,
  namespace: string | undefined,
  crds: KubeObject[] | null,
  icon = 'mdi:cube-outline',
  detailsComponent?: (props: { node: any }) => JSX.Element | null,
): object {
  const crdName = findCrdName(apiVersion, kind, crds);
  const node: any = {
    id,
    label: name,
    subtitle: namespace ? `${kind} · ${namespace}` : kind,
    icon: <Icon icon={icon} width="100%" height="100%" />,
    kubeObject: makeKubeObjectLike(apiVersion, kind, name, namespace),
  };
  if (crdName) node.customResourceDefinition = crdName;
  if (detailsComponent) node.detailsComponent = detailsComponent;
  return node;
}

/** Node factory for child XR nodes — uses fetched rawJson so XRMapDetail works. */
function makeSubXRNode(
  id: string,
  apiVersion: string,
  kind: string,
  name: string,
  namespace: string | undefined,
  rawJson: any,
): object {
  return {
    id,
    label: name,
    subtitle: namespace ? `${kind} · ${namespace}` : kind,
    icon: <Icon icon="mdi:layers-outline" width="100%" height="100%" />,
    kubeObject: makeXRKubeObjectFromJson(rawJson),
    weight: 1000,
    detailsComponent: XRMapDetail,
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
        ctx.nodeMap.set(compositeId, makeChildNode(compositeId, apiVersion, kind, name, namespace, ctx.crds, 'mdi:layers-outline'));
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
        ctx.nodeMap.set(compositeId, makeChildNode(compositeId, apiVersion, kind, name, namespace, ctx.crds, 'mdi:layers-outline'));
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

    ctx.nodeMap.set(uid, makeSubXRNode(uid, apiVersion, kind, name, namespace, rawJson));
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
  const mrNode = makeChildNode(compositeId, apiVersion, kind, name, namespace, ctx.crds, 'mdi:cube-outline', MRMapDetail) as any;
  // In the XR context (non-empty xrdGroupSet), direct children of an XR (depth 1)
  // are intermediate nodes — give them weight 1000 so the layout places them
  // between the root XR (2000) and any downstream resources (no weight).
  if (ctx.xrdGroupSet.size > 0 && depth === 1) mrNode.weight = 1000;
  ctx.nodeMap.set(compositeId, mrNode);
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

  // Enrich the stub kubeObject with the full JSON so Headlamp's graph renderer
  // can access status fields like readyReplicas on Deployment nodes.
  const existingNode = ctx.nodeMap.get(compositeId) as any;
  if (existingNode?.kubeObject) {
    existingNode.kubeObject.jsonData = rawJson;
    existingNode.kubeObject.spec   = rawJson?.spec;
    existingNode.kubeObject.status = rawJson?.status;
  }

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
    ctx.nodeMap.set(compositeId, makeChildNode(compositeId, apiVersion, kind, name, namespace, ctx.crds));
    const listNode = ctx.nodeMap.get(compositeId) as any;
    if (listNode?.kubeObject) {
      listNode.kubeObject.jsonData = item;
      listNode.kubeObject.spec   = item?.spec;
      listNode.kubeObject.status = item?.status;
    }
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

// ── Package graph expansion (Provider + Function) ─────────────────────────────

interface PackageGraphConfig {
  rootSubtitle: string;
  rootIcon: JSX.Element;
  rootDetailsComponent: (props: { node: any }) => JSX.Element | null;
  revisionSubtitle: string;
  revisionDetailsComponent: (props: { node: any }) => JSX.Element | null;
}

/**
 * Builds a package graph: Package → PackageRevision → Deployment.
 * Shared by Provider and Function sources — only icons/labels differ.
 * The Deployment edge targets the pre-existing node (by real UID) from Deployment.useList(),
 * mirroring the flux plugin pattern so the node is shared with Headlamp's workloads map.
 */
async function expandPackageGraphAsync(
  packages: KubeObject[],
  revisions: KubeObject[],
  deployments: KubeObject[] | null,
  crds: KubeObject[] | null,
  signal: AbortSignal,
  onUpdate: (state: GraphState) => void,
  config: PackageGraphConfig,
): Promise<void> {
  const ctx: ExpandContext = {
    xrdGroupSet: new Set(),
    claimKindSet: new Set(),
    xrdScopeMap: new Map(),
    crds,
    nodeMap: new Map(),
    edgeSet: new Set(),
    edges: [],
    visited: new Set(),
    signal,
  };

  const revByName = new Map<string, KubeObject>(
    revisions.map(r => [r.metadata.name as string, r])
  );

  let queue: QueueEntry[] = [];

  for (const pkg of packages) {
    const uid: string = pkg.metadata.uid;
    if (ctx.visited.has(uid)) continue;
    ctx.visited.add(uid);

    ctx.nodeMap.set(uid, {
      id: uid,
      label: pkg.metadata.name,
      subtitle: config.rootSubtitle,
      icon: config.rootIcon,
      kubeObject: pkg,
      weight: 2000,
      detailsComponent: config.rootDetailsComponent,
    });

    const currentRevision = pkg.jsonData?.status?.currentRevision as string | undefined;
    if (!currentRevision) continue;

    const revision = revByName.get(currentRevision);
    if (!revision) continue;

    const revUid: string = revision.metadata.uid;
    if (!ctx.visited.has(revUid)) {
      ctx.visited.add(revUid);
      ctx.nodeMap.set(revUid, {
        id: revUid,
        label: currentRevision,
        subtitle: config.revisionSubtitle,
        icon: <Icon icon="mdi:source-branch" width="100%" height="100%" />,
        kubeObject: revision,
        weight: 1000,
        detailsComponent: config.revisionDetailsComponent,
      });
    }
    addEdge(ctx, uid, revUid);

    // Find the pre-existing Deployment node by name (same name as the revision).
    // Using the real UID lets the map share/merge this node with Headlamp's
    // built-in workloads view, matching the flux plugin pattern.
    const deployment = deployments?.find(d => d.metadata.name === currentRevision);
    if (!deployment) continue;

    const deployUid: string = deployment.metadata.uid;
    const deployNs: string = deployment.metadata.namespace ?? '';
    if (!ctx.visited.has(deployUid)) {
      ctx.visited.add(deployUid);
      ctx.nodeMap.set(deployUid, {
        id: deployUid,
        label: deployment.metadata.name,
        subtitle: `Deployment · ${deployNs}`,
        kubeObject: deployment,
      });
      // Do NOT BFS-expand the Deployment's children — Headlamp's built-in
      // workloads source already owns the ReplicaSet → Pod chain via the
      // pre-existing node, so expanding here would duplicate the ReplicaSet.
    }
    addEdge(ctx, revUid, deployUid);
  }

  onUpdate({ nodes: [...ctx.nodeMap.values()], edges: [...ctx.edges] });

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

// ── Glance views ──────────────────────────────────────────────────────────────

type StatusChip = (props: { item: KubeObject }) => JSX.Element;

function makeGlance(kind: string, chips: StatusChip[]) {
  return function GlanceComponent({ node }: { node: any }) {
    const item = node.kubeObject as KubeObject | undefined;
    if (item?.kind !== kind) return null;
    return (
      <Box display="flex" gap={0.5} flexWrap="wrap">
        {chips.map((Chip, i) => <Chip key={i} item={item} />)}
      </Box>
    );
  };
}

registerKubeObjectGlance({
  id: 'crossplane-provider-glance',
  component: makeGlance('Provider', [InstalledStatus, HealthyStatus]),
});
registerKubeObjectGlance({
  id: 'crossplane-provider-revision-glance',
  component: makeGlance('ProviderRevision', [RuntimeHealthyStatus, RevisionHealthyStatus]),
});
registerKubeObjectGlance({
  id: 'crossplane-function-glance',
  component: makeGlance('Function', [InstalledStatus, HealthyStatus]),
});
registerKubeObjectGlance({
  id: 'crossplane-function-revision-glance',
  component: makeGlance('FunctionRevision', [RuntimeHealthyStatus, RevisionHealthyStatus]),
});

// ── Map source registration ───────────────────────────────────────────────────

function makePackageSource(
  id: string,
  label: string,
  usePackages: () => [KubeObject[] | null, any],
  useRevisions: () => [KubeObject[] | null, any],
  config: PackageGraphConfig,
) {
  return {
    id,
    label,
    icon: config.rootIcon,
    useData() {
      const [graph, setGraph] = useState<GraphState | null>(null);
      const [packages] = usePackages();
      const [revisions] = useRevisions();
      const [deployments] = K8s.ResourceClasses.Deployment.useList();
      const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();

      useEffect(() => {
        if (!packages || !revisions) return;
        const abort = new AbortController();
        setGraph(null);

        expandPackageGraphAsync(
          packages,
          revisions,
          deployments ?? null,
          crds ?? null,
          abort.signal,
          setGraph,
          config,
        );

        return () => abort.abort();
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [packages, revisions, deployments, crds]);

      return graph;
    },
  };
}

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

  const compositeResourcesSource = {
    id: 'crossplane-composite-resources',
    label: 'Composite Resources',
    icon: <Icon icon="mdi:layers-outline" width="100%" height="100%" />,
    sources: subSources,
  };

  const providersSource = makePackageSource(
    'crossplane-providers',
    'Providers',
    Provider.useList.bind(Provider),
    ProviderRevision.useList.bind(ProviderRevision),
    {
      rootSubtitle: 'Provider',
      rootIcon: <Icon icon="mdi:puzzle-outline" width="100%" height="100%" />,
      rootDetailsComponent: ProviderMapDetail,
      revisionSubtitle: 'ProviderRevision',
      revisionDetailsComponent: ProviderRevisionMapDetail,
    },
  );

  const functionsSource = makePackageSource(
    'crossplane-functions',
    'Functions',
    CrossplaneFunction.useList.bind(CrossplaneFunction),
    FunctionRevision.useList.bind(FunctionRevision),
    {
      rootSubtitle: 'Function',
      rootIcon: <Icon icon="mdi:function" width="100%" height="100%" />,
      rootDetailsComponent: FunctionMapDetail,
      revisionSubtitle: 'FunctionRevision',
      revisionDetailsComponent: FunctionRevisionMapDetail,
    },
  );

  registerMapSource({
    id: 'crossplane',
    label: 'Crossplane',
    icon: <Icon icon="logos:crossplane-icon" width="100%" height="100%" />,
    sources: [compositeResourcesSource, providersSource, functionsSource],
  } as any);
}
