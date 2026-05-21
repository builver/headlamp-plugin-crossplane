import { NodeType } from '../types';

export type ExprNodeKind = 'ref' | 'literal' | 'operation' | 'output';

export interface ExprNode {
  id: string;
  kind: ExprNodeKind;
  x: number;
  y: number;
  // ref fields
  nodeRef?: string;
  srcNodeId?: string;
  fieldPath?: string;
  fieldType?: string;
  optional?: boolean;
  // literal fields
  value?: string;
  valueType?: 'string' | 'number' | 'boolean' | 'cel';
  // operation fields
  category?: string;
  op?: string;
  /** For variadic nodes (e.g. string-concat): number of active input ports. Min 2. */
  portCount?: number;
}

export interface ExprEdge {
  id: string;
  srcNodeId: string;
  tgtNodeId: string;
  tgtPort: string;
}

export interface ExpressionGraph {
  nodes: ExprNode[];
  edges: ExprEdge[];
}

export interface PortDef {
  name: string;
  label: string;
  type: string;
}

export interface NodeDef {
  category: string;
  label: string;
  defaultOp: string;
  ops: Array<{ op: string; label: string }>;
  inputs: PortDef[];
  outputType: string;
  /** If true, the user can add/remove input ports beyond the base inputs list. */
  variadic?: boolean;
  /** True if this op uses a lambda variable (map, exists). */
  hasPredicate?: boolean;
  /** Name of the port that accepts the predicate/body expression ('pred' | 'expr'). */
  predicatePort?: string;
  toCel: (op: string, inputs: Record<string, string>) => string;
}

/** Source field entry for the ref-picker inside ExprCanvas. */
export interface PickerEntry {
  nodeId: string;
  nodeRef: string;
  nodeLabel: string;
  fieldPath: string;
  fieldType: string | undefined;
  nodeType: NodeType;
}
