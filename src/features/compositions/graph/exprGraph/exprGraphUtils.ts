import { CelNode, celNodeToCelInner, parseCelTemplate } from '../celAst';
import { refToNodeId } from '../constants';
import { EXPR_NODE_DEFS } from './ExprNodeDefs';
import { ExprEdge, ExpressionGraph, ExprNode } from './types';

// ── ID generation ────────────────────────────────────────────────────────────

let _seq = 0;
export function mkExprId(prefix: string): string {
  return `${prefix}-${++_seq}-${Math.random().toString(36).slice(2, 4)}`;
}

// ── Layout constants ─────────────────────────────────────────────────────────

const LAYER_X = [10, 190, 370];

export function exprNodeCardH(node: ExprNode): number {
  if (node.kind === 'operation') {
    const def = Object.values(EXPR_NODE_DEFS).find(d => d.category === node.category);
    const baseCount = def?.inputs.length ?? 1;
    const inputCount = (def?.variadic && node.portCount) ? Math.max(baseCount, node.portCount) : baseCount;
    return 22 + inputCount * 20 + 8;
  }
  return 34;
}

function autoLayout(nodes: ExprNode[], outputId: string): void {
  const layers: ExprNode[][] = [[], [], []];
  for (const n of nodes) {
    if (n.id === outputId) layers[2].push(n);
    else if (n.kind === 'operation') layers[1].push(n);
    else layers[0].push(n);
  }
  const CANVAS_H = 240;
  for (let li = 0; li < 3; li++) {
    const arr = layers[li];
    if (!arr.length) continue;
    const totalH = arr.reduce((s, n) => s + exprNodeCardH(n) + 8, -8);
    let curY = Math.max(8, (CANVAS_H - totalH) / 2);
    for (const n of arr) {
      n.x = LAYER_X[li];
      n.y = curY;
      curY += exprNodeCardH(n) + 8;
    }
  }
}

// ── buildFromCelNode ──────────────────────────────────────────────────────────

const OP_TO_CATEGORY: Record<string, string> = {
  '==': 'compare', '!=': 'compare', '>': 'compare', '<': 'compare', '>=': 'compare', '<=': 'compare',
  '&&': 'and', '||': 'or',
  '*': 'math', '/': 'math', '%': 'math',
};

/** Flattens a left-recursive chain of `+` binary nodes into a flat operand list. */
function collectConcatOperands(node: CelNode): CelNode[] {
  if (node.kind === 'binary' && node.op === '+') {
    return [...collectConcatOperands(node.left), ...collectConcatOperands(node.right)];
  }
  return [node];
}

function buildFromCelNode(node: CelNode, nodes: ExprNode[], edges: ExprEdge[]): string {
  switch (node.kind) {
    case 'ref': {
      const id = mkExprId('ref');
      nodes.push({
        id, kind: 'ref', x: LAYER_X[0], y: 0,
        nodeRef: node.nodeRef,
        srcNodeId: refToNodeId(node.nodeRef),
        fieldPath: node.fieldPath,
        optional: node.optional,
      });
      return id;
    }

    case 'literal': {
      const id = mkExprId('lit');
      const valueType = node.valueType === 'null' ? 'string' : node.valueType;
      nodes.push({ id, kind: 'literal', x: LAYER_X[0], y: 0, value: node.value, valueType });
      return id;
    }

    case 'binary': {
      // String concatenation: flatten the entire + chain into one variadic concat node
      if (node.op === '+') {
        const operands = collectConcatOperands(node);
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'string-concat', op: '+', x: LAYER_X[1], y: 0, portCount: operands.length });
        operands.forEach((operand, i) => {
          const childId = buildFromCelNode(operand, nodes, edges);
          edges.push({ id: mkExprId('e'), srcNodeId: childId, tgtNodeId: opNodeId, tgtPort: String.fromCharCode(65 + i) });
        });
        return opNodeId;
      }
      const category = OP_TO_CATEGORY[node.op];
      if (!category) {
        // Unsupported binary op — raw literal fallback
        const id = mkExprId('rawlit');
        nodes.push({ id, kind: 'literal', x: LAYER_X[0], y: 0, value: celNodeToCelInner(node), valueType: 'string' });
        return id;
      }
      const opNodeId = mkExprId('op');
      nodes.push({ id: opNodeId, kind: 'operation', category, op: node.op, x: LAYER_X[1], y: 0 });
      const leftId = buildFromCelNode(node.left, nodes, edges);
      edges.push({ id: mkExprId('e'), srcNodeId: leftId, tgtNodeId: opNodeId, tgtPort: 'A' });
      const rightId = buildFromCelNode(node.right, nodes, edges);
      edges.push({ id: mkExprId('e'), srcNodeId: rightId, tgtNodeId: opNodeId, tgtPort: 'B' });
      return opNodeId;
    }

    case 'unary': {
      if (node.op === '!') {
        const id = mkExprId('op');
        nodes.push({ id, kind: 'operation', category: 'not', op: '!', x: LAYER_X[1], y: 0 });
        const operandId = buildFromCelNode(node.operand, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: operandId, tgtNodeId: id, tgtPort: 'A' });
        return id;
      }
      // Other unary — raw fallback
      const id = mkExprId('rawlit');
      nodes.push({ id, kind: 'literal', x: LAYER_X[0], y: 0, value: celNodeToCelInner(node), valueType: 'string' });
      return id;
    }

    case 'ternary': {
      const id = mkExprId('cond');
      nodes.push({ id, kind: 'operation', category: 'conditional', op: '?:', x: LAYER_X[1], y: 0 });
      const condId = buildFromCelNode(node.cond, nodes, edges);
      edges.push({ id: mkExprId('e'), srcNodeId: condId, tgtNodeId: id, tgtPort: 'condition' });
      const thenId = buildFromCelNode(node.then_, nodes, edges);
      edges.push({ id: mkExprId('e'), srcNodeId: thenId, tgtNodeId: id, tgtPort: 'then' });
      const elseId = buildFromCelNode(node.else_, nodes, edges);
      edges.push({ id: mkExprId('e'), srcNodeId: elseId, tgtNodeId: id, tgtPort: 'else' });
      return id;
    }

    case 'call': {
      // Method call: receiver.replace(from, to)
      if (node.name === 'orValue' && node.receiver !== null && node.args.length === 1) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'optional-or-value', op: 'orValue', x: LAYER_X[1], y: 0 });
        const optId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: optId, tgtNodeId: opNodeId, tgtPort: 'opt' });
        const defaultId = buildFromCelNode(node.args[0], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: defaultId, tgtNodeId: opNodeId, tgtPort: 'default' });
        return opNodeId;
      }
      if (node.name === 'replace' && node.receiver !== null && node.args.length === 2) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'string-replace', op: 'replace', x: LAYER_X[1], y: 0 });
        const strId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: strId, tgtNodeId: opNodeId, tgtPort: 'str' });
        const fromId = buildFromCelNode(node.args[0], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: fromId, tgtNodeId: opNodeId, tgtPort: 'from' });
        const toId = buildFromCelNode(node.args[1], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: toId, tgtNodeId: opNodeId, tgtPort: 'to' });
        return opNodeId;
      }
      // filter / all / sortBy — receiver.fn(var, pred/expr)
      if (['filter', 'all', 'sortBy'].includes(node.name) && node.receiver !== null && node.args.length === 2) {
        const category = node.name === 'sortBy' ? 'sortBy' : node.name;
        const predPort = node.name === 'sortBy' ? 'expr' : 'pred';
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category, op: node.name, x: LAYER_X[1], y: 0 });
        const collId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: collId, tgtNodeId: opNodeId, tgtPort: 'collection' });
        const varId = buildFromCelNode(node.args[0], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: varId, tgtNodeId: opNodeId, tgtPort: 'var' });
        const predId = buildFromCelNode(node.args[1], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: predId, tgtNodeId: opNodeId, tgtPort: predPort });
        return opNodeId;
      }
      // join — receiver.join(sep)
      if (node.name === 'join' && node.receiver !== null && node.args.length <= 1) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'join', op: 'join', x: LAYER_X[1], y: 0 });
        const listId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: listId, tgtNodeId: opNodeId, tgtPort: 'list' });
        if (node.args.length === 1) {
          const sepId = buildFromCelNode(node.args[0], nodes, edges);
          edges.push({ id: mkExprId('e'), srcNodeId: sepId, tgtNodeId: opNodeId, tgtPort: 'sep' });
        }
        return opNodeId;
      }
      // split — receiver.split(sep)
      if (node.name === 'split' && node.receiver !== null && node.args.length >= 1) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'split', op: 'split', x: LAYER_X[1], y: 0 });
        const strId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: strId, tgtNodeId: opNodeId, tgtPort: 'str' });
        const sepId = buildFromCelNode(node.args[0], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: sepId, tgtNodeId: opNodeId, tgtPort: 'sep' });
        return opNodeId;
      }
      // string-case: lowerAscii / upperAscii / trim / reverse (string)
      if (['lowerAscii', 'upperAscii', 'trim', 'reverse'].includes(node.name) && node.receiver !== null && node.args.length === 0) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'string-case', op: node.name, x: LAYER_X[1], y: 0 });
        const strId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: strId, tgtNodeId: opNodeId, tgtPort: 'str' });
        return opNodeId;
      }
      // string-pred: contains / startsWith / endsWith / matches / find
      if (['contains', 'startsWith', 'endsWith', 'matches', 'find'].includes(node.name) && node.receiver !== null && node.args.length === 1) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'string-pred', op: node.name, x: LAYER_X[1], y: 0 });
        const strId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: strId, tgtNodeId: opNodeId, tgtPort: 'str' });
        const patId = buildFromCelNode(node.args[0], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: patId, tgtNodeId: opNodeId, tgtPort: 'pattern' });
        return opNodeId;
      }
      // substring — receiver.substring(start[, end])
      if (node.name === 'substring' && node.receiver !== null && node.args.length >= 1) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'substring', op: 'substring', x: LAYER_X[1], y: 0 });
        const strId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: strId, tgtNodeId: opNodeId, tgtPort: 'str' });
        const startId = buildFromCelNode(node.args[0], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: startId, tgtNodeId: opNodeId, tgtPort: 'start' });
        if (node.args.length >= 2) {
          const endId = buildFromCelNode(node.args[1], nodes, edges);
          edges.push({ id: mkExprId('e'), srcNodeId: endId, tgtNodeId: opNodeId, tgtPort: 'end' });
        }
        return opNodeId;
      }
      // list-unary: sort / flatten / distinct / reverse (list)
      if (['sort', 'flatten', 'distinct'].includes(node.name) && node.receiver !== null && node.args.length === 0) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'list-unary', op: node.name, x: LAYER_X[1], y: 0 });
        const listId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: listId, tgtNodeId: opNodeId, tgtPort: 'list' });
        return opNodeId;
      }
      // list-aggregate: sum / min / max
      if (['sum', 'min', 'max'].includes(node.name) && node.receiver !== null && node.args.length === 0) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'list-aggregate', op: node.name, x: LAYER_X[1], y: 0 });
        const listId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: listId, tgtNodeId: opNodeId, tgtPort: 'list' });
        return opNodeId;
      }
      // merge — receiver.merge(other)
      if (node.name === 'merge' && node.receiver !== null && node.args.length === 1) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'merge', op: 'merge', x: LAYER_X[1], y: 0 });
        const baseId = buildFromCelNode(node.receiver, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: baseId, tgtNodeId: opNodeId, tgtPort: 'base' });
        const overId = buildFromCelNode(node.args[0], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: overId, tgtNodeId: opNodeId, tgtPort: 'override' });
        return opNodeId;
      }
      // size — global size(val)
      if (node.name === 'size' && node.receiver === null && node.args.length === 1) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'size', op: 'size', x: LAYER_X[1], y: 0 });
        const valId = buildFromCelNode(node.args[0], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: valId, tgtNodeId: opNodeId, tgtPort: 'val' });
        return opNodeId;
      }
      // type-convert: string / int / bool — global calls
      if (['string', 'int', 'bool'].includes(node.name) && node.receiver === null && node.args.length === 1) {
        const opNodeId = mkExprId('op');
        nodes.push({ id: opNodeId, kind: 'operation', category: 'type-convert', op: node.name, x: LAYER_X[1], y: 0 });
        const valId = buildFromCelNode(node.args[0], nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: valId, tgtNodeId: opNodeId, tgtPort: 'val' });
        return opNodeId;
      }
      // Other calls — raw CEL fallback
      const callId = mkExprId('rawlit');
      nodes.push({ id: callId, kind: 'literal', x: LAYER_X[0], y: 0, value: celNodeToCelInner(node), valueType: 'cel' });
      return callId;
    }

    case 'raw': {
      const id = mkExprId('rawlit');
      nodes.push({ id, kind: 'literal', x: LAYER_X[0], y: 0, value: node.text, valueType: 'cel' });
      return id;
    }
  }
}

// ── fromCelTemplate ───────────────────────────────────────────────────────────

/**
 * Parses a raw CEL template string into an ExpressionGraph.
 * Recognises ref, literal, compare/logic/conditional/unary patterns.
 * Falls back to a raw literal node for complex multi-hole templates.
 */
export function fromCelTemplate(template: string, knownIds: Set<string>): ExpressionGraph {
  const nodes: ExprNode[] = [];
  const edges: ExprEdge[] = [];

  const outputId = mkExprId('output');
  nodes.push({ id: outputId, kind: 'output', x: LAYER_X[2], y: 0 });

  if (template.trim()) {
    const tpl = parseCelTemplate(template, knownIds);
    const interps = tpl.filter(s => s.kind === 'interp');
    const hasTextSep = tpl.some(s => s.kind === 'text' && s.text.trim() !== '');

    if (hasTextSep || interps.length > 1) {
      // Mixed text+interp or multi-hole — represent as raw literal
      const litId = mkExprId('rawlit');
      nodes.push({ id: litId, kind: 'literal', x: LAYER_X[0], y: 0, value: template, valueType: 'string' });
      edges.push({ id: mkExprId('e'), srcNodeId: litId, tgtNodeId: outputId, tgtPort: 'input' });
    } else if (interps.length === 1) {
      const interp = interps[0];
      if (interp.kind === 'interp') {
        const rootId = buildFromCelNode(interp.cel, nodes, edges);
        edges.push({ id: mkExprId('e'), srcNodeId: rootId, tgtNodeId: outputId, tgtPort: 'input' });
      }
    }
    // interps.length === 0 means a static text template — no root node connected
  }

  autoLayout(nodes, outputId);
  return { nodes, edges };
}

// ── Port position helpers ─────────────────────────────────────────────────────

export const EXPR_NODE_W = 130;

export function exprOutPortPos(node: ExprNode): { x: number; y: number } {
  return { x: node.x + EXPR_NODE_W, y: node.y + exprNodeCardH(node) / 2 };
}

export function exprInPortPos(node: ExprNode, portIdx: number): { x: number; y: number } {
  if (node.kind === 'operation') return { x: node.x, y: node.y + 22 + portIdx * 20 + 10 };
  return { x: node.x, y: node.y + exprNodeCardH(node) / 2 };
}

// ── toCelTemplate ─────────────────────────────────────────────────────────────

function serializeToCel(nodeId: string, nodeMap: Map<string, ExprNode>, edgesByTgt: Map<string, ExprEdge[]>): string {
  const n = nodeMap.get(nodeId);
  if (!n) return '';

  if (n.kind === 'ref') {
    if (!n.fieldPath) return n.nodeRef ?? '';
    return `${n.nodeRef}.${n.fieldPath}`;
  }

  if (n.kind === 'literal') {
    if (n.valueType === 'cel') return n.value ?? '';
    if (n.valueType === 'string') {
      return `"${(n.value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return n.value ?? '';
  }

  if (n.kind === 'operation') {
    const def = Object.values(EXPR_NODE_DEFS).find(d => d.category === n.category);
    if (!def) return '';
    const inEdges = edgesByTgt.get(nodeId) ?? [];
    const inputs: Record<string, string> = {};
    if (def.variadic) {
      // Include all connected ports, not just the two defined in NodeDef.inputs
      for (const e of inEdges) {
        inputs[e.tgtPort] = serializeToCel(e.srcNodeId, nodeMap, edgesByTgt);
      }
    } else {
      for (const port of def.inputs) {
        const e = inEdges.find(ed => ed.tgtPort === port.name);
        inputs[port.name] = e ? serializeToCel(e.srcNodeId, nodeMap, edgesByTgt) : port.name;
      }
    }
    return def.toCel(n.op ?? def.defaultOp, inputs);
  }

  return '';
}

/**
 * Serialises an ExpressionGraph back to a CEL template string.
 * Returns '' if the output node has no connected input.
 */
export function toCelTemplate(graph: ExpressionGraph): string {
  const outputNode = graph.nodes.find(n => n.kind === 'output');
  if (!outputNode) return '';

  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  const edgesByTgt = new Map<string, ExprEdge[]>();
  for (const e of graph.edges) {
    if (!edgesByTgt.has(e.tgtNodeId)) edgesByTgt.set(e.tgtNodeId, []);
    edgesByTgt.get(e.tgtNodeId)!.push(e);
  }

  const rootEdge = (edgesByTgt.get(outputNode.id) ?? []).find(e => e.tgtPort === 'input');
  if (!rootEdge) return '';

  const rootNode = nodeMap.get(rootEdge.srcNodeId);
  if (!rootNode) return '';

  if (rootNode.kind === 'ref') {
    if (!rootNode.fieldPath) return `\${${rootNode.nodeRef ?? ''}}`;
    return `\${${rootNode.nodeRef}.${rootNode.fieldPath}}`;
  }

  if (rootNode.kind === 'literal') {
    if (rootNode.valueType === 'cel') return `\${${rootNode.value ?? ''}}`;
    if (rootNode.valueType === 'string') {
      const v = rootNode.value ?? '';
      // If it contains CEL interpolations, return the raw template directly
      if (v.includes('${')) return v;
      return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return rootNode.value ?? '';
  }

  // operation → bare CEL, wrapped in ${}
  const cel = serializeToCel(rootNode.id, nodeMap, edgesByTgt);
  return `\${${cel}}`;
}
