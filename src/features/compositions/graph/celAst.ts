// AST for CEL (Common Expression Language) expressions.
// Used by the kro graph editor to parse/serialize field value templates.

// ── AST Types ──────────────────────────────────────────────────────────────────

export interface AstRef {
  kind: 'ref';
  nodeRef: string;    // CEL identifier: 'schema', 'env', or resource id
  fieldPath: string;  // dot-separated path, e.g. 'spec.foo.bar'
  optional: boolean;  // true if optional-chain ?. was used
}

export interface AstLiteral {
  kind: 'literal';
  value: string;
  valueType: 'string' | 'number' | 'boolean' | 'null';
}

export interface AstBinary {
  kind: 'binary';
  op: string;   // '==', '!=', '&&', '||', '>', '<', '>=', '<=', '+', '-'
  left: CelNode;
  right: CelNode;
}

export interface AstUnary {
  kind: 'unary';
  op: string;   // '!', '-'
  operand: CelNode;
}

export interface AstTernary {
  kind: 'ternary';
  cond: CelNode;
  then_: CelNode;
  else_: CelNode;
}

export interface AstCall {
  kind: 'call';
  name: string;
  receiver: CelNode | null;  // null for global calls: size(x)
  args: CelNode[];
}

export interface AstRaw {
  kind: 'raw';
  text: string;  // fallback for unrecognized syntax
}

export type CelNode = AstRef | AstLiteral | AstBinary | AstUnary | AstTernary | AstCall | AstRaw;

export type CelTemplateSegment =
  | { kind: 'text'; text: string }
  | { kind: 'interp'; cel: CelNode };

export type CelTemplate = CelTemplateSegment[];

// ── Scanner ───────────────────────────────────────────────────────────────────

class Scanner {
  pos: number = 0;
  constructor(readonly s: string) {}

  skipWs(): void {
    while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) this.pos++;
  }

  peek(offset = 0): string { return this.s[this.pos + offset] ?? ''; }
  eof(): boolean { return this.pos >= this.s.length; }
  startsWith(prefix: string): boolean { return this.s.startsWith(prefix, this.pos); }

  readIdent(): string {
    const start = this.pos;
    while (this.pos < this.s.length && /[a-zA-Z0-9_]/.test(this.s[this.pos])) this.pos++;
    return this.s.slice(start, this.pos);
  }

  readString(quote: string): string {
    let str = '';
    while (this.pos < this.s.length) {
      const ch = this.s[this.pos];
      if (ch === '\\') { this.pos++; str += this.s[this.pos] ?? ''; this.pos++; continue; }
      if (ch === quote) { this.pos++; break; }
      str += ch; this.pos++;
    }
    return str;
  }
}

// ── Operator precedence (higher = binds tighter) ──────────────────────────────

function opPrec(op: string): number {
  if (op === '||') return 2;
  if (op === '&&') return 3;
  if (op === '==' || op === '!=') return 4;
  if (op === '<' || op === '>' || op === '<=' || op === '>=') return 5;
  if (op === '+' || op === '-') return 6;
  if (op === '*' || op === '/' || op === '%') return 7;
  return 0;
}

// ── Recursive-descent parser ──────────────────────────────────────────────────

function parseTernary(sc: Scanner, ids: Set<string>): CelNode {
  const cond = parseOr(sc, ids);
  sc.skipWs();
  if (sc.peek() === '?') {
    sc.pos++;
    const then_ = parseTernary(sc, ids);
    sc.skipWs();
    if (sc.peek() === ':') {
      sc.pos++;
      const else_ = parseTernary(sc, ids);
      return { kind: 'ternary', cond, then_, else_ };
    }
  }
  return cond;
}

function parseOr(sc: Scanner, ids: Set<string>): CelNode {
  let left = parseAnd(sc, ids);
  while (true) {
    sc.skipWs();
    if (sc.startsWith('||')) { sc.pos += 2; left = { kind: 'binary', op: '||', left, right: parseAnd(sc, ids) }; }
    else break;
  }
  return left;
}

function parseAnd(sc: Scanner, ids: Set<string>): CelNode {
  let left = parseEquality(sc, ids);
  while (true) {
    sc.skipWs();
    if (sc.startsWith('&&')) { sc.pos += 2; left = { kind: 'binary', op: '&&', left, right: parseEquality(sc, ids) }; }
    else break;
  }
  return left;
}

function parseEquality(sc: Scanner, ids: Set<string>): CelNode {
  let left = parseRelational(sc, ids);
  while (true) {
    sc.skipWs();
    if (sc.startsWith('==')) { sc.pos += 2; left = { kind: 'binary', op: '==', left, right: parseRelational(sc, ids) }; }
    else if (sc.startsWith('!=')) { sc.pos += 2; left = { kind: 'binary', op: '!=', left, right: parseRelational(sc, ids) }; }
    else break;
  }
  return left;
}

function parseRelational(sc: Scanner, ids: Set<string>): CelNode {
  let left = parseAddSub(sc, ids);
  while (true) {
    sc.skipWs();
    if (sc.startsWith('>=')) { sc.pos += 2; left = { kind: 'binary', op: '>=', left, right: parseAddSub(sc, ids) }; }
    else if (sc.startsWith('<=')) { sc.pos += 2; left = { kind: 'binary', op: '<=', left, right: parseAddSub(sc, ids) }; }
    else if (sc.peek() === '>' && sc.peek(1) !== '=') { sc.pos++; left = { kind: 'binary', op: '>', left, right: parseAddSub(sc, ids) }; }
    else if (sc.peek() === '<' && sc.peek(1) !== '=') { sc.pos++; left = { kind: 'binary', op: '<', left, right: parseAddSub(sc, ids) }; }
    else break;
  }
  return left;
}

function parseMulDiv(sc: Scanner, ids: Set<string>): CelNode {
  let left = parseUnary(sc, ids);
  while (true) {
    sc.skipWs();
    if (sc.peek() === '*') { sc.pos++; left = { kind: 'binary', op: '*', left, right: parseUnary(sc, ids) }; }
    else if (sc.peek() === '/' && sc.peek(1) !== '/') { sc.pos++; left = { kind: 'binary', op: '/', left, right: parseUnary(sc, ids) }; }
    else if (sc.peek() === '%') { sc.pos++; left = { kind: 'binary', op: '%', left, right: parseUnary(sc, ids) }; }
    else break;
  }
  return left;
}

function parseAddSub(sc: Scanner, ids: Set<string>): CelNode {
  let left = parseMulDiv(sc, ids);
  while (true) {
    sc.skipWs();
    if (sc.peek() === '+') { sc.pos++; left = { kind: 'binary', op: '+', left, right: parseMulDiv(sc, ids) }; }
    else if (sc.peek() === '-') { sc.pos++; left = { kind: 'binary', op: '-', left, right: parseMulDiv(sc, ids) }; }
    else break;
  }
  return left;
}

function parseUnary(sc: Scanner, ids: Set<string>): CelNode {
  sc.skipWs();
  if (sc.peek() === '!') { sc.pos++; return { kind: 'unary', op: '!', operand: parseUnary(sc, ids) }; }
  return parsePostfix(sc, ids);
}

function parseArgs(sc: Scanner, ids: Set<string>): CelNode[] {
  const args: CelNode[] = [];
  sc.skipWs();
  if (sc.peek() !== ')') {
    args.push(parseTernary(sc, ids));
    sc.skipWs();
    while (sc.peek() === ',') { sc.pos++; args.push(parseTernary(sc, ids)); sc.skipWs(); }
  }
  if (sc.peek() === ')') sc.pos++;
  return args;
}

function parsePostfix(sc: Scanner, ids: Set<string>): CelNode {
  let node = parsePrimary(sc, ids);
  while (true) {
    sc.skipWs();
    const isOpt = sc.startsWith('?.');
    const isDot = !isOpt && sc.peek() === '.';

    if (isOpt || isDot) {
      const savedPos = sc.pos;
      sc.pos += isOpt ? 2 : 1;
      sc.skipWs();

      // Handle '.?ident' dot-optional syntax (kro uses '.' then '?' before the field name)
      let dotOpt = false;
      if (isDot && sc.peek() === '?' && /[a-zA-Z_]/.test(sc.peek(1))) {
        sc.pos++; // consume '?'
        dotOpt = true;
      }

      const seg = sc.readIdent();
      if (!seg) { sc.pos = savedPos; break; }
      sc.skipWs();

      const effectiveOpt = isOpt || dotOpt;

      if (sc.peek() === '(') {
        sc.pos++; // consume (
        node = { kind: 'call', name: seg, receiver: node, args: parseArgs(sc, ids) };
      } else if (node.kind === 'ref') {
        // Extend the ref's fieldPath, embedding '?' at the right position
        node = {
          ...node,
          fieldPath: node.fieldPath
            ? `${node.fieldPath}.${effectiveOpt ? '?' : ''}${seg}`
            : (effectiveOpt ? `?${seg}` : seg),
          optional: node.optional || effectiveOpt,
        };
      } else {
        // Field access on a non-ref node — fall back to raw
        node = { kind: 'raw', text: `${celNodeToCelInner(node)}.${seg}` };
      }
    } else if (sc.peek() === '[') {
      sc.pos++;
      const idx = parseTernary(sc, ids);
      sc.skipWs();
      if (sc.peek() === ']') sc.pos++;
      node = { kind: 'raw', text: `${celNodeToCelInner(node)}[${celNodeToCelInner(idx)}]` };
    } else {
      break;
    }
  }
  return node;
}

function parsePrimary(sc: Scanner, ids: Set<string>): CelNode {
  sc.skipWs();
  const ch = sc.peek();

  // Quoted string
  if (ch === '"' || ch === "'") {
    sc.pos++;
    return { kind: 'literal', value: sc.readString(ch), valueType: 'string' };
  }

  // Parenthesized expression
  if (ch === '(') {
    sc.pos++;
    const inner = parseTernary(sc, ids);
    sc.skipWs();
    if (sc.peek() === ')') sc.pos++;
    return inner;
  }

  // Array literal — capture verbatim as raw (supports [], [a, b], etc.)
  if (ch === '[') {
    const start = sc.pos;
    let depth = 0; let inStr2 = false; let strCh2 = '';
    while (!sc.eof()) {
      const c2 = sc.s[sc.pos];
      if (inStr2) { if (c2 === '\\') sc.pos++; else if (c2 === strCh2) inStr2 = false; sc.pos++; continue; }
      if (c2 === '"' || c2 === "'") { inStr2 = true; strCh2 = c2; sc.pos++; continue; }
      if (c2 === '[') { depth++; sc.pos++; continue; }
      if (c2 === ']') { depth--; sc.pos++; if (depth === 0) break; continue; }
      sc.pos++;
    }
    return { kind: 'raw', text: sc.s.slice(start, sc.pos) };
  }

  // Numeric literal
  if (/\d/.test(ch)) {
    const start = sc.pos;
    while (sc.pos < sc.s.length && /[0-9.]/.test(sc.s[sc.pos])) sc.pos++;
    return { kind: 'literal', value: sc.s.slice(start, sc.pos), valueType: 'number' };
  }

  // Identifier (keyword / known-ref / global-call / raw)
  if (/[a-zA-Z_]/.test(ch)) {
    const name = sc.readIdent();
    if (name === 'true')  return { kind: 'literal', value: 'true',  valueType: 'boolean' };
    if (name === 'false') return { kind: 'literal', value: 'false', valueType: 'boolean' };
    if (name === 'null')  return { kind: 'literal', value: 'null',  valueType: 'null' };

    sc.skipWs();

    // Global function call: name(args)
    if (sc.peek() === '(') {
      sc.pos++;
      return { kind: 'call', name, receiver: null, args: parseArgs(sc, ids) };
    }

    // Known ref — fieldPath will be built by parsePostfix
    if (ids.has(name)) return { kind: 'ref', nodeRef: name, fieldPath: '', optional: false };

    // Unknown identifier
    return { kind: 'raw', text: name };
  }

  // Fallback — consume the rest as raw
  const rest = sc.s.slice(sc.pos).trim();
  sc.pos = sc.s.length;
  return { kind: 'raw', text: rest };
}

// ── Public parse API ──────────────────────────────────────────────────────────

/** Finds the closing `}` of a `${` interpolation, skipping over string literals. */
export function findCelClose(s: string, from: number): number {
  let i = from; let inStr = false; let strChar = '';
  while (i < s.length) {
    const ch = s[i];
    if (inStr) { if (ch === '\\') i++; else if (ch === strChar) inStr = false; i++; continue; }
    if (ch === '"' || ch === "'") { inStr = true; strChar = ch; i++; continue; }
    if (ch === '}') return i;
    i++;
  }
  return -1;
}

/**
 * Parses a bare CEL expression (the content inside `${…}`) into a `CelNode` AST.
 */
export function parseCelAst(inner: string, knownIds: Set<string>): CelNode {
  const sc = new Scanner(inner.trim());
  if (sc.eof()) return { kind: 'raw', text: '' };
  const node = parseTernary(sc, knownIds);
  sc.skipWs();
  if (!sc.eof()) return { kind: 'raw', text: inner.trim() };
  return node;
}

/**
 * Parses a CEL template string (containing `${…}` interpolations) into typed segments.
 * Text between interpolations becomes `{ kind: 'text' }`; each `${expr}` becomes `{ kind: 'interp' }`.
 */
export function parseCelTemplate(template: string, knownIds: Set<string>): CelTemplate {
  if (!template) return [];
  const result: CelTemplate = [];
  let pos = 0;
  while (pos < template.length) {
    if (template.startsWith('${', pos)) {
      const closeIdx = findCelClose(template, pos + 2);
      if (closeIdx > 0) {
        const inner = template.slice(pos + 2, closeIdx);
        result.push({ kind: 'interp', cel: parseCelAst(inner, knownIds) });
        pos = closeIdx + 1;
        continue;
      }
    }
    // Text segment — consume until the next `${`
    let end = pos + 1;
    while (end < template.length && !(template[end] === '$' && template[end + 1] === '{')) end++;
    result.push({ kind: 'text', text: template.slice(pos, end) });
    pos = end;
  }
  return result;
}

// ── Serializer ────────────────────────────────────────────────────────────────

/**
 * Serialises a `CelNode` to a bare CEL expression string (no `${}`).
 * Pass `minPrec = 0` (default) for the top-level call; the function recurses with
 * higher `minPrec` values to add parens only where needed by precedence rules.
 */
export function celNodeToCelInner(node: CelNode, minPrec = 0): string {
  switch (node.kind) {
    case 'ref': {
      if (!node.fieldPath) return node.nodeRef;
      return `${node.nodeRef}.${node.fieldPath}`;
    }
    case 'literal': {
      if (node.valueType === 'string') {
        return `"${node.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      }
      return node.value;
    }
    case 'binary': {
      const prec = opPrec(node.op);
      // Left arm: wrap if child prec < parent (left-associative: same prec is fine on left)
      const leftStr  = celNodeToCelInner(node.left,  prec);
      // Right arm: wrap if child prec <= parent (same prec needs parens for right arm)
      const rightStr = celNodeToCelInner(node.right, prec + 1);
      const expr = `${leftStr} ${node.op} ${rightStr}`;
      return prec < minPrec ? `(${expr})` : expr;
    }
    case 'unary':
      return `${node.op}${celNodeToCelInner(node.operand, 100)}`;
    case 'ternary': {
      const expr = `${celNodeToCelInner(node.cond)} ? ${celNodeToCelInner(node.then_)} : ${celNodeToCelInner(node.else_)}`;
      // Ternary has lower precedence than any binary op — wrap when inside a binary
      return minPrec > 1 ? `(${expr})` : expr;
    }
    case 'call': {
      const args = node.args.map(a => celNodeToCelInner(a, 0)).join(', ');
      if (node.receiver) return `${celNodeToCelInner(node.receiver, 100)}.${node.name}(${args})`;
      return `${node.name}(${args})`;
    }
    case 'raw':
      return node.text;
  }
}

/**
 * Serialises a `CelTemplate` back to a raw template string.
 * Text segments are emitted as-is; interp segments become `${celExpr}`.
 */
export function celTemplateToString(template: CelTemplate): string {
  return template.map(seg => {
    if (seg.kind === 'text') return seg.text;
    return `\${${celNodeToCelInner(seg.cel)}}`;
  }).join('');
}
