export interface PortDef {
  name: string;
  label: string;
  type: string;
}

export interface NodeDef {
  category: string;
  label: string;
  group: 'Logic' | 'String' | 'Collection' | 'Type / Math' | 'Advanced';
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
