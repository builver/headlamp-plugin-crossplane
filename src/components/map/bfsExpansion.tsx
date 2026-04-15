import { Icon } from '@iconify/react';
import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { XRScope } from '../../resources';
import { buildGetPath, buildListPath, getGroupVersion, lookupPlural } from './apiPaths';
import { MAX_DEPTH,OWNER_REF_CHILDREN } from './constants';
import { ClaimMapDetail, MRMapDetail, XRMapDetail } from './detailComponents';
import { makeChildNode, makeSubXRNode } from './nodeFactories';
import { ExpandContext, GraphState, ResourceRef } from './types';

export type QueueEntry =
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

export function addEdge(ctx: ExpandContext, source: string, target: string) {
  const id = `${source}-->${target}`;
  if (!ctx.edgeSet.has(id)) {
    ctx.edgeSet.add(id);
    ctx.edges.push({ id, source, target });
  }
}

export async function processGetEntry(
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

export async function processListByOwnerEntry(
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

export async function runBfsWaves(
  queue: QueueEntry[],
  ctx: ExpandContext,
  signal: AbortSignal,
  onUpdate: (state: GraphState) => void,
): Promise<void> {
  while (queue.length > 0 && !signal.aborted) {
    const wave = queue.splice(0);

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

export async function expandGraphAsync(
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

  const queue: QueueEntry[] = [];

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

  await runBfsWaves(queue, ctx, signal, onUpdate);
}
