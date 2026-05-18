import { FieldSuggestion, NodeCfg, NodeType, TRow } from './types';

// ── Node ID constants ──────────────────────────────────────────────────────────

export const SCHEMA_NODE_ID = '__schema__';
export const ENV_NODE_ID    = '__env__';
export const DRAFT_NODE_ID  = '__draft__';

// ── Layout constants ───────────────────────────────────────────────────────────

export const NW          = 264;
export const HEADER_H    = 30;
export const ROW_H       = 20;
export const NODE_MIN_H  = 72;
export const HG          = 104;
export const VG          = 32;
export const CANVAS_SIZE = 4000;
export const DOT         = 10;

export function nodeH(rows: TRow[]): number {
  return rows.length === 0 ? NODE_MIN_H : HEADER_H + rows.length * ROW_H + 8;
}

// ── Node visual config ─────────────────────────────────────────────────────────

export const NODE_CFG: Record<NodeType, NodeCfg> = {
  schema:         { icon: 'mdi:file-tree-outline',    accent: '#1565c0', accentDark: '#90caf9', label: 'Schema'   },
  env:            { icon: 'mdi:link-variant',          accent: '#92660a', accentDark: '#fcd34d', label: 'Required' },
  'kro-resource': { icon: 'mdi:cube-outline',          accent: '#1b5e20', accentDark: '#a5d6a7', label: 'Resource' },
  'kro-ref':      { icon: 'mdi:link-box-outline',      accent: '#6a1b9a', accentDark: '#ce93d8', label: 'External' },
  draft:          { icon: 'mdi:plus-circle-outline',   accent: '#455a64', accentDark: '#b0bec5', label: 'New'      },
};

export function refAccent(ref: string, dark: boolean, nodeType?: NodeType): string {
  const type: NodeType = ref === 'schema' ? 'schema' : ref === 'env' ? 'env' : (nodeType ?? 'kro-resource');
  const cfg = NODE_CFG[type];
  return dark ? cfg.accentDark : cfg.accent;
}

export const EDGE_TYPE_FOR: Record<string, string> = { schema: 'kro-schema', env: 'kro-env' };
export const USER_C_LIGHT = '#7b1fa2';
export const USER_C_DARK  = '#ce93d8';

/** Maps a CEL ref identifier ('schema'|'env'|resourceId) to its graph node ID. */
export function refToNodeId(ref: string): string {
  if (ref === 'schema') return SCHEMA_NODE_ID;
  if (ref === 'env')    return ENV_NODE_ID;
  return ref;
}

/** Inverse of refToNodeId: maps a graph node ID to its CEL ref identifier. */
export function nodeIdToRef(nodeId: string): string {
  if (nodeId === SCHEMA_NODE_ID) return 'schema';
  if (nodeId === ENV_NODE_ID)    return 'env';
  return nodeId;
}

// ── Field suggestions for autocomplete ────────────────────────────────────────

/** Field paths that are always map[string]* in every Kubernetes resource. */
export const K8S_MAP_PATHS = new Set(['metadata.labels', 'metadata.annotations']);

/** Always-available source fields on every Kubernetes resource node. */
export const K8S_BASE_FIELDS: FieldSuggestion[] = [
  { path: 'apiVersion',                  type: 'string'  },
  { path: 'kind',                        type: 'string'  },
  { path: 'metadata.name',               type: 'string'  },
  { path: 'metadata.namespace',          type: 'string'  },
  { path: 'metadata.uid',                type: 'string'  },
  { path: 'metadata.labels',             type: 'object'  },
  { path: 'metadata.annotations',        type: 'object'  },
  { path: 'metadata.generation',         type: 'integer' },
  { path: 'metadata.resourceVersion',    type: 'string'  },
  { path: 'metadata.creationTimestamp',  type: 'string'  },
];
