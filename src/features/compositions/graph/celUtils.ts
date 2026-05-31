import { refToNodeId } from './constants';
import { CelRef, NodeRow,RowSegment } from './types';

/** Creates a fresh `${refId.path}` CEL interpolation regex. Always returns a new instance (g flag). */
export const celInterpRe = () => /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\.([^}]+)\}/g;

/** Returns true for simple dot-paths like `spec.forProvider.region` or `spec.?foo.bar` — no operators, spaces, or quotes. */
export function isSimplePath(path: string): boolean {
  return /^(\??[a-zA-Z_][a-zA-Z0-9_]*)(\.\??[a-zA-Z_][a-zA-Z0-9_]*)*$/.test(path.trim());
}

/** CEL operators inserted by the picker — these trigger CEL-expression mode for a run. */
export const CEL_OPS_SET = new Set([' == ', ' != ', ' && ', ' || ', ' > ', ' < ', ' >= ', ' <= ']);

/** Pretty labels shown in the visual builder for each operator literal. */
export const OP_DISPLAY: Record<string, string> = {
  ' == ': '=',   ' != ': '≠',
  ' && ': 'and', ' || ': 'or',
  ' > ':  '>',   ' < ':  '<',
  ' >= ': '≥',   ' <= ': '≤',
};

/** Returns the last dot-segment of a path, with `?` optional-chaining markers stripped. */
export function shortFieldName(path: string): string {
  const clean = stripOptionalMarkers(path);
  return clean.split('.').pop() ?? clean;
}

/** Removes all `?` optional-chaining markers from a path. Used wherever path
 *  identity should ignore the runtime null-tolerance hint — e.g. matching an
 *  edge's frozen `srcPortPath` against a row's mutable `inPort.srcPath` after
 *  the user has toggled segment optionality via the popover. */
export function stripOptionalMarkers(s: string): string {
  return s.replace(/\?/g, '');
}

/** Splits an `inPort.srcPath` / `ExtraEdge.srcFieldPath` (e.g. `?spec.?foo.bar`)
 *  into per-segment records. Order matches the dot-path order. Empty input
 *  returns []. Degenerate inputs (`'a..b'`, `'.foo'`, `'a.'`, lone `'?'`)
 *  silently drop empty-name segments so the popover never renders blank rows
 *  and the setter never re-emits malformed paths. */
export function splitSrcPath(srcPath: string): { name: string; optional: boolean }[] {
  if (!srcPath) return [];
  const out: { name: string; optional: boolean }[] = [];
  for (const seg of srcPath.split('.')) {
    const optional = seg.startsWith('?');
    const name = optional ? seg.slice(1) : seg;
    if (!name) continue;
    out.push({ name, optional });
  }
  return out;
}

/** Returns a new srcPath with the `?` marker on segment `idx` set to `value`.
 *  Idempotent. Out-of-range `idx` returns the input unchanged. */
export function setSegmentOptional(srcPath: string, idx: number, value: boolean): string {
  const segs = splitSrcPath(srcPath);
  if (idx < 0 || idx >= segs.length) return srcPath;
  if (segs[idx].optional === value) return srcPath;
  segs[idx] = { ...segs[idx], optional: value };
  return segs.map(s => (s.optional ? '?' : '') + s.name).join('.');
}

/** Runs the CEL interpolation regex over `str`, returning only matches whose ref is in `knownIds`. */
export function collectCelMatches(str: string, knownIds: Set<string>): RegExpExecArray[] {
  const RE = celInterpRe();
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = RE.exec(str)) !== null) { if (knownIds.has(m[1])) matches.push(m); }
  return matches;
}

/**
 * If `matches` contains exactly one match and `val` is exactly that interpolation with a simple
 * dot-path, returns the parsed components. Returns null otherwise.
 */
export function parseSingleRefMatch(
  matches: RegExpExecArray[], val: string,
): { ref: string; srcPath: string; srcShort: string; optional: boolean } | null {
  if (matches.length !== 1 || val.trim() !== matches[0][0] || !isSimplePath(matches[0][2])) return null;
  const srcPath = matches[0][2];
  return { ref: matches[0][1], srcPath, srcShort: shortFieldName(srcPath), optional: srcPath.includes('?') };
}

/** Recursively walks an unknown value, calling `onString` for every string leaf. */
export function walkTemplate(obj: unknown, onString: (s: string) => void): void {
  if (typeof obj === 'string') { onString(obj); }
  else if (Array.isArray(obj)) { obj.forEach(v => walkTemplate(v, onString)); }
  else if (obj !== null && typeof obj === 'object') {
    Object.values(obj as Record<string, unknown>).forEach(v => walkTemplate(v, onString));
  }
}

/** Splits a CEL-interpolated string into typed segments for display. */
export function parseSegments(val: string, known: Set<string>): RowSegment[] {
  const RE = celInterpRe();
  const segs: RowSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(val)) !== null) {
    if (m.index > last) segs.push({ kind: 'literal', text: val.slice(last, m.index) });
    const ref = m[1]; const path = m[2];
    const srcNodeId = refToNodeId(ref);
    if (known.has(ref)) {
      const displayText = isSimplePath(path) ? shortFieldName(path) : 'expr';
      segs.push({ kind: 'cel', text: displayText, srcRef: ref, srcPath: path, srcNodeId });
    } else {
      segs.push({ kind: 'literal', text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < val.length) segs.push({ kind: 'literal', text: val.slice(last) });
  return segs;
}

/** Recursively collects all AstRef nodes from a CelNode AST. */
function collectAstRefs(node: CelNode, out: AstRef[]): void {
  switch (node.kind) {
    case 'ref': out.push(node); break;
    case 'binary': collectAstRefs(node.left, out); collectAstRefs(node.right, out); break;
    case 'unary': collectAstRefs(node.operand, out); break;
    case 'ternary': collectAstRefs(node.cond, out); collectAstRefs(node.then_, out); collectAstRefs(node.else_, out); break;
    case 'call':
      if (node.receiver) collectAstRefs(node.receiver, out);
      for (const arg of node.args) collectAstRefs(arg, out);
      break;
  }
}

export function findCelRefs(template: unknown, known: Set<string>): CelRef[] {
  const seen = new Set<string>(); const out: CelRef[] = [];
  walkTemplate(template, (s: string) => {
    for (const seg of parseCelTemplate(s, known)) {
      if (seg.kind !== 'interp') continue;
      const refs: AstRef[] = [];
      collectAstRefs(seg.cel, refs);
      for (const ref of refs) {
        if (!ref.fieldPath || !known.has(ref.nodeRef)) continue;
        const k = `${ref.nodeRef}::${ref.fieldPath}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push({ srcRef: ref.nodeRef, srcPath: ref.fieldPath, srcShort: shortFieldName(ref.fieldPath) });
        }
      }
    }
  });
  return out;
}

/** Extracts balanced-parentheses content starting at `from`.
 *  Returns the inner content and the position immediately after the closing ')'. */
export function extractGroup(s: string, from: number): { inner: string; end: number } | null {
  if (s[from] !== '(') return null;
  let depth = 0;
  for (let i = from; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { if (--depth === 0) return { inner: s.slice(from + 1, i), end: i + 1 }; }
  }
  return null;
}

/** Finds the closing '}' of '${', correctly skipping over string literals. */
export function findCelClose(s: string, from: number): number {
  let i = from; let inStr = false; let strChar = '';
  while (i < s.length) {
    const ch = s[i];
    if (inStr) { if (ch === '\\') { i++; } else if (ch === strChar) { inStr = false; } i++; continue; }
    if (ch === '"' || ch === "'") { inStr = true; strChar = ch; i++; continue; }
    if (ch === '}') return i;
    i++;
  }
  return -1;
}

/** Finds the top-level ternary operator (? and :) in a bare CEL expression, skipping over
 *  parens, brackets, and string literals. */
export function findTopLevelTernary(s: string): { cond: string; then_: string; else_: string } | null {
  let depth = 0; let inStr = false; let strChar = ''; let qPos = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (ch === '\\') { i++; } else if (ch === strChar) { inStr = false; } continue; }
    if (ch === '"' || ch === "'") { inStr = true; strChar = ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === '?' && depth === 0 && qPos < 0) qPos = i;
    else if (ch === ':' && depth === 0 && qPos >= 0) {
      return { cond: s.slice(0, qPos).trim(), then_: s.slice(qPos + 1, i).trim(), else_: s.slice(i + 1).trim() };
    }
  }
  return null;
}


/**
 * Validates a bare CEL expression (the content inside `${…}`).
 * Returns an error string, or null if no obvious problems are found.
 */
export function validateCelInner(s: string): string | null {
  let depth = 0; let inStr = false; let strChar = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (ch === '\\') { i++; } else if (ch === strChar) { inStr = false; } continue; }
    if (ch === '"' || ch === "'") { inStr = true; strChar = ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') { if (--depth < 0) return 'unbalanced parentheses'; }
  }
  if (depth !== 0) return 'unbalanced parentheses';
  if (inStr) return 'unclosed string literal';
  const t = s.trim();
  if (!t) return 'empty expression';
  if (/^(==|!=|&&|\|\||>=|<=|[><])/.test(t)) return 'expression starts with an operator';
  if (/(==|!=|&&|\|\||>=|<=)$/.test(t)) return 'expression ends with an operator';
  return null;
}

/** Rebuilds raw CEL string from RowSegment[]. */
export function reconstructTemplate(segments: RowSegment[]): string {
  return segments.map(s => s.kind === 'cel' ? `\${${s.srcRef}.${s.srcPath}}` : s.text).join('');
}

/**
 * Returns a copy of `row` with its display fields replaced by what `template` says.
 * Used to overlay fieldEdits onto nodes for rendering without mutating nodes state.
 * Always uses segment pills (never the `inPort` "string" type annotation) so users
 * can see the actual value they entered.
 */
export function overlayRowWithTemplate(row: NodeRow, template: string, knownIds: Set<string>): NodeRow {
  const base = { ...row, inPort: undefined, segments: undefined, celExpr: undefined, value: undefined };
  const matches = collectCelMatches(template, knownIds);
  // Simple single-ref template → keep inPort display so the segment popover works.
  // Preserve the baseline row's forEach-rewrite (ref=nodeId, origRef=CEL identifier
  // from postProcessEachRefs) when the parsed template still uses the same CEL
  // identifier — otherwise the overlay would drop the wiring back to the resource
  // node and the pill would point at a non-existent ref.
  const single = parseSingleRefMatch(matches, template);
  if (single) {
    const baseInPort = row.inPort;
    if (baseInPort?.origRef && single.ref === baseInPort.origRef) {
      return { ...base, inPort: { ref: baseInPort.ref, srcPath: single.srcPath, srcShort: single.srcShort, origRef: baseInPort.origRef } };
    }
    return { ...base, inPort: { ref: single.ref, srcPath: single.srcPath, srcShort: single.srcShort } };
  }
  if (matches.length > 0) return { ...base, segments: parseSegments(template, knownIds) };
  if (/^\$\{(true|false|null|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')\}$/.test(template)) return { ...base, value: template };
  if (/\$\{/.test(template)) return { ...base, celExpr: template };
  return { ...base, value: template };
}

// ══════════════════════════════════════════════════════════════════════════════
// CEL AST
// AST types and parser for CEL expressions. Merged from the former celAst.ts so
// the kro graph editor has a single CEL module to reach for.
// ══════════════════════════════════════════════════════════════════════════════


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
