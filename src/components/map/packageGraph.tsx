import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useEffect, useState } from 'react';
import { addEdge } from './bfsExpansion';
import { ExpandContext, GraphState } from './types';

export interface PackageGraphConfig {
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
export async function expandPackageGraphAsync(
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
    }
    addEdge(ctx, revUid, deployUid);
  }

  onUpdate({ nodes: [...ctx.nodeMap.values()], edges: [...ctx.edges] });
}

export function makePackageSource(
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
      // Periodic refresh counter — increments every 10 s to re-run the graph
      // build and pick up deployments that may have been missed by the watch
      // (e.g. when the deployment didn't exist yet at page-load time and a
      // WebSocket event was lost before it was delivered).
      const [tick, setTick] = useState(0);
      useEffect(() => {
        const id = setInterval(() => setTick(t => t + 1), 10_000);
        return () => clearInterval(id);
      }, []);

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
      }, [packages, revisions, deployments, crds, tick]);

      return graph;
    },
  };
}
