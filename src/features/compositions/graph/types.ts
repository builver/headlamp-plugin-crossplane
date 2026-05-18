// ── Types ──────────────────────────────────────────────────────────────────────

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

export interface TRow {
  depth: number;
  key: string;
  isParent: boolean;
  value?: string;
  /** Raw CEL expression that didn't match the simple ref.path pattern (multiline or contains operators). */
  celExpr?: string;
  fieldPath?: string;
  inPort?: { ref: string; srcPath: string; srcShort: string };
  outPort?: { path: string; short: string };
  /** Set when the value is a composed string with 2+ refs or mixed literal+CEL. */
  segments?: RowSegment[];
  /** True for rows the user manually added (not from the original template). */
  isVirtual?: boolean;
  /** True for rows that are schema suggestions not yet present in the template. */
  isGhost?: boolean;
  /** For ghost leaf rows: the field type from the schema. */
  ghostType?: string;
  /** True for parent rows that represent an array container (e.g. spec.containers). */
  isArrayParent?: boolean;
}

/** Identifies which CEL token is being hovered, for edge + node highlight. */
export interface TokenHover {
  srcNodeId: string;
  srcPath: string;
  tgtNodeId: string;
}

export interface GNode {
  id: string;
  type: NodeType;
  label: string;
  sublabel?: string;
  rows: TRow[];
  x: number; y: number; w: number; h: number;
}

export interface GEdge {
  id: string;
  source: string; target: string;
  srcPortPath: string; tgtPortKey: string;
  type: EdgeType;
}

export interface ExtraEdge {
  id: string;
  srcNodeId: string; srcFieldPath: string;
  tgtNodeId: string; tgtFieldPath: string;
}

export interface Drawing {
  srcNodeId: string;
  srcFieldPath: string;
  canvasX: number; canvasY: number;
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

export interface BuilderToken {
  id: string;
  kind: 'ref' | 'literal' | 'conditional';
  // ref-only
  nodeRef?: string;    // CEL identifier (schema / env / resource-id)
  nodeId?: string;     // graph node id (__schema__ / __env__ / resource-id)
  fieldPath?: string;  // dot-separated path within the ref
  fieldType?: string;  // type from schema (string, integer, boolean, …)
  optional?: boolean;  // emit ${ref.?path} for optional chaining
  // literal-only
  text?: string;
  isString?: boolean;  // if true: value is a CEL string literal — serialised with double-quotes
  // conditional-only — each part is itself a token sequence
  condTokens?: BuilderToken[];
  thenTokens?: BuilderToken[];
  elseTokens?: BuilderToken[];
}

export type TypeCompat = 'ok' | 'coerce' | 'incompatible';

/** Where the picker will insert the next token. */
export type PickerTarget =
  | { kind: 'main'; slot: number }
  | { kind: 'cond'; tokenIdx: number; part: 'cond' | 'then' | 'else'; slot: number };

export interface OutPort { path: string; short: string }

export interface CelRef { srcRef: string; srcPath: string; srcShort: string }

export interface FieldSuggestion { path: string; type: string }

export interface NodeCfg { icon: string; accent: string; accentDark: string; label: string }

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

