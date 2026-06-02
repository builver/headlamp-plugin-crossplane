import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useEffect, useMemo, useRef, useState } from 'react';
import { XRScope } from '../../resources';
import { getOrCreateClass } from '../../resources/crdClassCache';
import { getGroupVersion } from './apiPaths';
import { ClaimMapDetail, MRMapDetail, XRMapDetail } from './detailComponents';
import { makeChildNode, makeSubXRNode } from './nodeFactories';
import { GraphState, ResourceRef } from './types';

const MAX_DEPTH = 5;

interface WatchTarget {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
}

function refKey(
  apiVersion: string,
  kind: string,
  namespace: string | undefined,
  name: string,
): string {
  return `${apiVersion}/${kind}/${namespace ?? ''}/${name}`;
}

function getResourceClass(
  apiVersion: string,
  kind: string,
  crds: KubeObject[],
): any | null {
  const builtin = Object.values(K8s.ResourceClasses).find(
    cls => (cls as any).kind === kind && (cls as any).apiVersion === apiVersion,
  );
  if (builtin) return builtin;

  const [group, version] = getGroupVersion(apiVersion);
  const crd = crds.find(
    c =>
      c.jsonData?.spec?.group === group &&
      c.jsonData?.spec?.names?.kind === kind,
  );
  if (!crd) return null;
  const spec = crd.jsonData?.spec ?? {};
  const versions = (spec.versions ?? [])
    .filter((v: any) => v.served !== false)
    .map((v: any) => ({ group, version: v.name }));
  return getOrCreateClass({
    crdName: crd.metadata.name as string,
    group,
    kind,
    plural: spec.names?.plural ?? '',
    versions: versions.length ? versions : [{ group, version }],
    isNamespaced: spec.scope === 'Namespaced',
  });
}

/**
 * Reactive replacement for the imperative BFS expansion. Maintains a watch
 * (initial GET + WebSocket) per sub-XR reachable from the top-level items,
 * synchronously rebuilds the graph on every state change, and reconciles
 * watches as the tree grows or shrinks.
 *
 * Top-level XRs come from the caller's useList (already watched). Leaf MR
 * and native nodes are not watched here — they're terminal placeholders
 * whose detail panels open their own useGet on click.
 */
export function useXrTreeGraph(
  items: KubeObject[] | null,
  scope: XRScope,
  xrdGroupSet: Set<string>,
  claimKindSet: Set<string>,
  xrdScopeMap: Map<string, XRScope>,
  crds: KubeObject[] | null,
): GraphState | null {
  const [resources, setResources] = useState<Map<string, any>>(new Map());
  const watchersRef = useRef<Map<string, () => void>>(new Map());

  // Walk reachable refs to determine which sub-XRs should be watched.
  // Re-derives on every render — cheap, and naturally extends as new data
  // arrives (resources update → desiredWatches recomputes → effect adds watch).
  const desiredWatches = useMemo(() => {
    const set = new Map<string, WatchTarget>();
    if (!items) return set;
    const queue: { obj: any; depth: number; parentScope: XRScope }[] = items.map(
      it => ({ obj: it.jsonData, depth: 0, parentScope: scope }),
    );
    while (queue.length) {
      const { obj, depth, parentScope } = queue.shift()!;
      if (depth >= MAX_DEPTH || !obj) continue;
      const xrNamespace: string | undefined = obj?.metadata?.namespace;
      const refs: ResourceRef[] =
        parentScope === 'LegacyCluster'
          ? (obj?.spec?.resourceRefs ?? [])
          : (obj?.spec?.crossplane?.resourceRefs ?? []);
      for (const ref of refs) {
        const [refGroup] = getGroupVersion(ref.apiVersion);
        if (claimKindSet.has(`${refGroup}/${ref.kind}`)) continue;
        if (!xrdGroupSet.has(`${refGroup}/${ref.kind}`)) continue;
        const resolvedNs =
          parentScope === 'Namespaced' ? (ref.namespace ?? xrNamespace) : ref.namespace;
        const key = refKey(ref.apiVersion, ref.kind, resolvedNs, ref.name);
        if (set.has(key)) continue;
        set.set(key, {
          apiVersion: ref.apiVersion,
          kind: ref.kind,
          name: ref.name,
          namespace: resolvedNs,
        });
        const fetched = resources.get(key);
        if (fetched) {
          const childScope =
            xrdScopeMap.get(`${refGroup}/${ref.kind}`) ?? 'LegacyCluster';
          queue.push({ obj: fetched, depth: depth + 1, parentScope: childScope });
        }
      }
    }
    return set;
  }, [items, resources, scope, xrdGroupSet, claimKindSet, xrdScopeMap]);

  // Reconcile watches against the desired set.
  useEffect(() => {
    if (!crds) return;
    const current = watchersRef.current;

    for (const [key, target] of desiredWatches) {
      if (current.has(key)) continue;
      const cls = getResourceClass(target.apiVersion, target.kind, crds);
      const ep = cls?.apiEndpoint;
      if (!ep?.get) continue;

      let cancelled = false;
      let cancelFn: (() => void) | null = null;
      const args: any[] = ep.isNamespaced ? [target.namespace] : [];
      args.push(
        target.name,
        (json: any) => {
          if (cancelled) return;
          setResources(prev => {
            const cur = prev.get(key);
            const newRv = json?.metadata?.resourceVersion;
            const curRv = cur?.metadata?.resourceVersion;
            if (cur && newRv && curRv === newRv) return prev;
            const next = new Map(prev);
            next.set(key, json);
            return next;
          });
        },
        (err: any) => {
          // eslint-disable-next-line no-console
          console.warn(`[crossplane] map watch failed for ${key}:`, err);
        },
      );
      const cancelPromise: Promise<() => void> = ep.get.apply(null, args);
      cancelPromise.then(c => {
        if (cancelled) c();
        else cancelFn = c;
      });
      current.set(key, () => {
        cancelled = true;
        cancelFn?.();
      });
    }

    for (const [key, cancel] of [...current.entries()]) {
      if (!desiredWatches.has(key)) {
        cancel();
        current.delete(key);
        setResources(prev => {
          if (!prev.has(key)) return prev;
          const next = new Map(prev);
          next.delete(key);
          return next;
        });
      }
    }
  }, [desiredWatches, crds]);

  // Cancel everything on unmount.
  useEffect(
    () => () => {
      watchersRef.current.forEach(c => c());
      watchersRef.current.clear();
    },
    [],
  );

  return useMemo<GraphState | null>(() => {
    if (!items) return null;

    const nodes = new Map<string, object>();
    const edgeSet = new Set<string>();
    const edges: { id: string; source: string; target: string }[] = [];
    const visited = new Set<string>();

    const addEdge = (source: string, target: string) => {
      const id = `${source}-->${target}`;
      if (!edgeSet.has(id)) {
        edgeSet.add(id);
        edges.push({ id, source, target });
      }
    };

    interface WaveEntry {
      apiVersion: string;
      kind: string;
      name: string;
      namespace?: string;
      parentNodeId: string;
      depth: number;
      isXR: boolean;
      parentScope: XRScope;
    }
    const queue: WaveEntry[] = [];

    for (const xr of items) {
      const xrUid = xr.metadata.uid as string;
      if (visited.has(xrUid)) continue;
      visited.add(xrUid);

      nodes.set(xrUid, {
        id: xrUid,
        kubeObject: xr,
        weight: 2000,
        detailsComponent: XRMapDetail,
      });

      const xrNamespace = xr.metadata.namespace as string | undefined;
      const claimRef =
        scope === 'LegacyCluster' ? (xr.jsonData?.spec?.claimRef ?? null) : null;
      if (claimRef?.name) {
        const claimId = `Claim::${claimRef.namespace ?? ''}::${claimRef.name}`;
        if (!nodes.has(claimId)) {
          nodes.set(claimId, {
            id: claimId,
            label: claimRef.name,
            subtitle: claimRef.namespace
              ? `${claimRef.kind ?? 'Claim'} · ${claimRef.namespace}`
              : (claimRef.kind ?? 'Claim'),
            icon: <Icon icon="mdi:inbox-outline" width="100%" height="100%" />,
            data: {
              kind: claimRef.kind,
              name: claimRef.name,
              namespace: claimRef.namespace,
            },
            detailsComponent: ClaimMapDetail,
          });
        }
        addEdge(claimId, xrUid);
      }

      const childRefs: ResourceRef[] =
        scope === 'LegacyCluster'
          ? (xr.jsonData?.spec?.resourceRefs ?? [])
          : (xr.jsonData?.spec?.crossplane?.resourceRefs ?? []);
      for (const ref of childRefs) {
        const [refGroup] = getGroupVersion(ref.apiVersion);
        if (claimKindSet.has(`${refGroup}/${ref.kind}`)) continue;
        const isChildXR = xrdGroupSet.has(`${refGroup}/${ref.kind}`);
        const resolvedNs =
          scope === 'Namespaced' ? (ref.namespace ?? xrNamespace) : ref.namespace;
        queue.push({
          apiVersion: ref.apiVersion,
          kind: ref.kind,
          name: ref.name,
          namespace: resolvedNs,
          parentNodeId: xrUid,
          depth: 1,
          isXR: isChildXR,
          parentScope: isChildXR
            ? (xrdScopeMap.get(`${refGroup}/${ref.kind}`) ?? 'LegacyCluster')
            : scope,
        });
      }
    }

    while (queue.length) {
      const entry = queue.shift()!;
      const { apiVersion, kind, name, namespace, parentNodeId, depth, isXR, parentScope } =
        entry;
      const compositeId = `${apiVersion}::${kind}::${namespace ?? ''}::${name}`;

      if (!isXR) {
        if (!visited.has(compositeId)) {
          visited.add(compositeId);
          const node = makeChildNode(
            compositeId,
            apiVersion,
            kind,
            name,
            namespace,
            crds,
            'mdi:cube-outline',
            MRMapDetail,
          ) as any;
          if (xrdGroupSet.size > 0 && depth === 1) node.weight = 1000;
          nodes.set(compositeId, node);
        }
        addEdge(parentNodeId, compositeId);
        continue;
      }

      const key = refKey(apiVersion, kind, namespace, name);
      const json = resources.get(key);
      if (!json) {
        if (!nodes.has(compositeId)) {
          nodes.set(
            compositeId,
            makeChildNode(
              compositeId,
              apiVersion,
              kind,
              name,
              namespace,
              crds,
              'mdi:layers-outline',
            ),
          );
        }
        addEdge(parentNodeId, compositeId);
        continue;
      }

      const uid: string = json?.metadata?.uid ?? compositeId;
      if (visited.has(uid)) {
        addEdge(parentNodeId, uid);
        continue;
      }
      visited.add(uid);
      nodes.set(uid, makeSubXRNode(uid, apiVersion, kind, name, namespace, json));
      addEdge(parentNodeId, uid);

      if (depth >= MAX_DEPTH) continue;

      const childRefs: ResourceRef[] =
        parentScope === 'LegacyCluster'
          ? (json?.spec?.resourceRefs ?? [])
          : (json?.spec?.crossplane?.resourceRefs ?? []);
      const childXrNs = json?.metadata?.namespace as string | undefined;
      for (const ref of childRefs) {
        const [refGroup] = getGroupVersion(ref.apiVersion);
        if (claimKindSet.has(`${refGroup}/${ref.kind}`)) continue;
        const isGrandChildXR = xrdGroupSet.has(`${refGroup}/${ref.kind}`);
        const resolvedNs =
          parentScope === 'Namespaced' ? (ref.namespace ?? childXrNs) : ref.namespace;
        queue.push({
          apiVersion: ref.apiVersion,
          kind: ref.kind,
          name: ref.name,
          namespace: resolvedNs,
          parentNodeId: uid,
          depth: depth + 1,
          isXR: isGrandChildXR,
          parentScope: isGrandChildXR
            ? (xrdScopeMap.get(`${refGroup}/${ref.kind}`) ?? 'LegacyCluster')
            : parentScope,
        });
      }
    }

    return { nodes: [...nodes.values()], edges };
  }, [items, resources, crds, scope, xrdGroupSet, claimKindSet, xrdScopeMap]);
}
