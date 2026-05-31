// ── Types ──────────────────────────────────────────────────────────────────────
//
// Composition-graph naming standard (apply to every new type/identifier here):
//
//   1. Operator/expression nodes are called "Expr" (not "Op"). Catalogs, state,
//      types, files, constants, and helpers use the `Expr`/`expr` term.
//   2. Graph-domain types carry no prefix. Use full words (`GraphNode`,
//      `GraphEdge`, `NodeRow`, `NodeConfig`, `OutputPort`) — never `G*` or `T*`.
//   3. The two card families are siblings rendered inside `NodeCardShell`:
//        - `RowsNodeCard` for row-based nodes (schema/env/kro-resource/kro-ref)
//        - `ExprNodeCard`  for operator/expression nodes
//      Don't introduce a third card without an explicit reason.
//   4. Layout constants are spelled out and family-prefixed: `NODE_*` for the
//      row card (the unmarked default), `EXPR_NODE_*` for the operator card.
//      No cryptic abbreviations (`NW`/`HG`/`VG`/`DOT` were retired).
//
// See /Users/tim/.claude/plans/ for the rationale behind this standard if the
// commit history doesn't make it obvious.

export type NodeType = 'schema' | 'env' | 'kro-resource' | 'kro-ref' | 'draft';
export type EdgeType = 'kro-dep' | 'kro-schema' | 'kro-env' | 'user';

/** A segment of a composed CEL string, e.g. `${schema.spec.foo}-static`. */
export interface RowSegment {
  kind: 'literal' | 'cel';
  text: string;        // display text: literal chars, or short field name for cel
  srcRef?: string;     // cel only: ref id ('schema', 'env', or resource id)
  srcPath?: string;    // cel only: full path (e.g. 'spec.foo')
  srcNodeId?: string;  // cel only: resolved graph node id ('__schema__', '__env__', or id)
}

export interface NodeRow {
  depth: number;
  key: string;
  isParent: boolean;
  value?: string;
  /** Raw CEL expression that didn't match the simple ref.path pattern (multiline or contains operators). */
  celExpr?: string;
  fieldPath?: string;
  /** When this row's value is a single CEL ref (e.g. `${schema.spec.foo}`).
   *  `srcPath` keeps the per-segment `?` markers verbatim (e.g. `?spec.?foo.bar`);
   *  derive aggregate optionality with `srcPath.includes('?')`. */
  inPort?: { ref: string; srcPath: string; srcShort: string; origRef?: string };
  outPort?: { path: string; short: string };
  /** Set when the value is a composed string with 2+ refs or mixed literal+CEL. */
  segments?: RowSegment[];
  /** True for rows the user manually added (not from the original template). */
  isVirtual?: boolean;
  /** True for rows that are schema suggestions not yet present in the template. */
  isGhost?: boolean;
  /** Visual section-header divider row (forEach / includeWhen / readyWhen label). No port dots. */
  isSection?: boolean;
  /** For ghost leaf rows: the field type from the schema. */
  ghostType?: string;
  /** True for parent rows that represent an array container (e.g. spec.containers). */
  isArrayParent?: boolean;
  /** Indented sub-field row under a forEach variable row (e.g. role.name output port). */
  isForEachSubField?: boolean;
  /** Can this row receive an incoming connection (left drop target). Defaults to true for leaf rows. */
  canImport?: boolean;
  /** Can this row originate an outgoing connection (right port dot). Defaults to true for non-section rows. */
  canExport?: boolean;
  /** Resolved value from composed resource (read-only mode). */
  actualValue?: string;
}

/** Identifies which CEL token is being hovered, for edge + node highlight. */
export interface TokenHover {
  srcNodeId: string;
  srcPath: string;
  tgtNodeId: string;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  sublabel?: string;
  rows: NodeRow[];
  x: number; y: number; w: number; h: number;
  /** True when this node represents a kro forEach resource template. The
   *  read-only XR view renders it as a stack of cards and fans out instances
   *  on selection. */
  isCollection?: boolean;
}

export interface GraphEdge {
  id: string;
  source: string; target: string;
  srcPortPath: string; tgtPortKey: string;
  /** Target row's `fieldPath` — required to disambiguate when multiple rows on
   *  the same target node share the same `inPort` (e.g. two fields with the
   *  same `${ref.path}` CEL expression). */
  tgtFieldPath: string;
  type: EdgeType;
}

export interface ExtraEdge {
  id: string;
  srcNodeId: string; srcFieldPath: string;
  tgtNodeId: string; tgtFieldPath: string;
}

export interface ExprNode {
  id: string;
  category: string;
  op: string;
  x: number; y: number;
  literals: Record<string, string>;
  /** For variadic nodes (e.g. string-concat): number of active input ports. Min 2. */
  portCount?: number;
  /** For raw-template nodes: user-resized height in pixels. */
  h?: number;
  /** Taint IDs active on this node. 'forEach' = self-ref source; op node ID = predicate scope. */
  taints?: string[];
  /** For predicate ops (map, exists): sub-field paths on the lambda var exposed as output ports. */
  varFields?: string[];
}

export interface Drawing {
  srcNodeId: string;
  srcFieldPath: string;
  canvasX: number; canvasY: number;
  srcType?: string;
}

export interface HoverTarget {
  nodeId: string;
  /** rowIdx < node.rows.length → existing row; rowIdx >= node.rows.length → potential field row. */
  rowIdx: number;
  fieldPath?: string;
}

export interface FieldEdit {
  nodeId: string;
  fieldPath: string;
  template: string;   // raw CEL string, e.g. "${schema.spec.foo}-static"
}

export interface EditingRow {
  nodeId: string;
  fieldPath: string;
  currentTemplate: string;  // initial template value; builder tokens are source of truth during editing
}

export type TypeCompat = 'ok' | 'coerce' | 'incompatible';

export interface OutputPort { path: string; short: string }

export interface CelRef { srcRef: string; srcPath: string; srcShort: string }

export interface FieldSuggestion { path: string; type: string }

export interface NodeConfig { icon: string; accent: string; accentDark: string; label: string }

export interface KindOption {
  kind: string;
  apiVersion: string;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export type PendingResource =
  | { type: 'template';    id: string; apiVersion: string; kind: string }
  | { type: 'externalRef'; id: string; apiVersion: string; kind: string; name?: string; matchLabels?: Record<string, string> };

export interface AddForm {
  id: string;
  apiVersion: string;
  kind: string;
  mode: 'template' | 'externalRef';
  refLookup: 'name' | 'selector';
  refName: string;
  refLabels: Array<{ key: string; value: string }>;
}

