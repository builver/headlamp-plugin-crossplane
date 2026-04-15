import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { XRScope } from '../../resources';

export interface ResourceRef {
  apiVersion: string;
  kind: string;
  name: string;
  namespace?: string;
}

export interface GraphState {
  nodes: object[];
  edges: Array<{ id: string; source: string; target: string }>;
}

export interface ExpandContext {
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
