import { FieldSuggestion, NodeCfg, NodeType, OpNode, TRow } from './types';

// ── Node ID constants ──────────────────────────────────────────────────────────

export const SCHEMA_NODE_ID  = '__schema__';
export const DRAFT_NODE_ID   = '__draft__';
/** Prefix for ExtraEdge srcFieldPath values that reference a predicate op's lambda variable sub-field. */
export const VAR_FIELD_PREFIX = 'var:';

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
  'kro-ref':      { icon: 'mdi:link-box-outline',      accent: '#e65100', accentDark: '#ffb74d', label: 'External' },
  'kro-resource': { icon: 'mdi:cube-outline',          accent: '#1b5e20', accentDark: '#a5d6a7', label: 'Resource' },
  draft:          { icon: 'mdi:plus-circle-outline',   accent: '#455a64', accentDark: '#b0bec5', label: 'New'      },
};

export function refAccent(ref: string, dark: boolean, nodeType?: NodeType): string {
  const type: NodeType = ref === 'schema' ? 'schema' : (nodeType ?? 'kro-resource');
  const cfg = NODE_CFG[type];
  return dark ? cfg.accentDark : cfg.accent;
}

export const EDGE_TYPE_FOR: Record<string, string> = { schema: 'kro-schema' };
export const USER_C_LIGHT = '#7b1fa2';
export const USER_C_DARK  = '#ce93d8';

/** Maps a CEL ref identifier ('schema'|'env'|resourceId) to its graph node ID. */
export function refToNodeId(ref: string): string {
  if (ref === 'schema') return SCHEMA_NODE_ID;
  return ref;
}

/** Inverse of refToNodeId: maps a graph node ID to its CEL ref identifier. */
export function nodeIdToRef(nodeId: string): string {
  if (nodeId === SCHEMA_NODE_ID) return 'schema';
  return nodeId;
}

// ── Field suggestions for autocomplete ────────────────────────────────────────

/** Field paths that are always map[string]* in every Kubernetes resource. */
export const K8S_MAP_PATHS = new Set(['metadata.labels', 'metadata.annotations']);

// ── Op node layout ─────────────────────────────────────────────────────────────

export const OP_NODE_W      = 160;
export const OP_NODE_HDR_H  = 28;
export const OP_NODE_PORT_H = 24;

export const RAW_TEMPLATE_NODE_H = 112;

export function opNodeH(portCount: number): number {
  return OP_NODE_HDR_H + portCount * OP_NODE_PORT_H;
}

export function opNodeInputPortY(node: OpNode, portIdx: number): number {
  return node.y + OP_NODE_HDR_H + portIdx * OP_NODE_PORT_H + OP_NODE_PORT_H / 2;
}

/**
 * Builds a deduplicated, alphabetically-sorted flat tree from varFields.
 * Intermediate parent paths that are not explicit varFields are included as
 * structural (non-exportable) rows, matching resource-node row behaviour.
 */
export function buildVarFieldRows(varFields: string[]): Array<{ path: string; depth: number; key: string; isExportable: boolean }> {
  const varFieldSet = new Set(varFields);
  const allPaths = new Set<string>();
  for (const vf of varFields) {
    const segs = vf.split('.');
    for (let i = 1; i <= segs.length; i++) allPaths.add(segs.slice(0, i).join('.'));
  }
  return Array.from(allPaths).sort().map(path => {
    const segs = path.split('.');
    return { path, depth: segs.length - 1, key: segs[segs.length - 1], isExportable: varFieldSet.has(path) };
  });
}

/**
 * Total extra rows consumed by the predicate varFields section:
 * one row per unique tree node across all varFields, plus 1 for the "add field" input row.
 */
export function opNodeVarFieldExtraRows(varFields: string[]): number {
  return buildVarFieldRows(varFields).length + 1;
}

/**
 * Absolute row index (counted from port row 0) of the row for varField at index vfi.
 * varPortIdx is the index of the 'var' input port among the node's fixed inputs.
 */
export function varFieldLeafRow(varFields: string[], varPortIdx: number, vfi: number): number {
  const rows = buildVarFieldRows(varFields);
  const path = varFields[vfi];
  const idx = rows.findIndex(r => r.path === path);
  return varPortIdx + 1 + Math.max(0, idx);
}

// eslint-disable-next-line no-unused-vars
export function opNodeOutputPortY(node: OpNode, _portCount: number): number {
  return node.y + OP_NODE_HDR_H / 2;
}

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
