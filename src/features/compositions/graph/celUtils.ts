import { AstRef, CelNode, parseCelTemplate } from './celAst';
import { refToNodeId } from './constants';
import { CelRef, RowSegment, TRow } from './types';

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
  const clean = path.replace(/\?/g, '');
  return clean.split('.').pop() ?? clean;
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
export function overlayRowWithTemplate(row: TRow, template: string, knownIds: Set<string>): TRow {
  const base = { ...row, inPort: undefined, segments: undefined, celExpr: undefined, value: undefined };
  const matches = collectCelMatches(template, knownIds);
  // Simple single-ref template → keep inPort display so the ? toggle stays available
  const single = parseSingleRefMatch(matches, template);
  if (single) {
    return { ...base, inPort: { ref: single.ref, srcPath: single.srcPath, srcShort: single.srcShort, optional: single.optional } };
  }
  if (matches.length > 0) return { ...base, segments: parseSegments(template, knownIds) };
  if (/^\$\{(true|false|null|-?\d+(?:\.\d+)?|"[^"]*"|'[^']*')\}$/.test(template)) return { ...base, value: template };
  if (/\$\{/.test(template)) return { ...base, celExpr: template };
  return { ...base, value: template };
}
