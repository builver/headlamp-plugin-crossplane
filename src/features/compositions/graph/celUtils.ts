import { refToNodeId } from './constants';
import { BuilderToken, CelRef, RowSegment, TRow, TypeCompat } from './types';

/** Creates a fresh `${refId.path}` CEL interpolation regex. Always returns a new instance (g flag). */
export const celInterpRe = () => /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\.([^}]+)\}/g;

/** Returns true for simple dot-paths like `spec.forProvider.region` — no operators, spaces, or quotes. */
export function isSimplePath(path: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_.[\]]*$/.test(path.trim());
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
      const displayText = isSimplePath(path) ? (path.split('.').pop() ?? path) : 'expr';
      segs.push({ kind: 'cel', text: displayText, srcRef: ref, srcPath: path, srcNodeId });
    } else {
      segs.push({ kind: 'literal', text: m[0] });
    }
    last = m.index + m[0].length;
  }
  if (last < val.length) segs.push({ kind: 'literal', text: val.slice(last) });
  return segs;
}

export function findCelRefs(template: unknown, known: Set<string>): CelRef[] {
  const seen = new Set<string>(); const out: CelRef[] = [];
  const RE = celInterpRe();
  function walk(obj: unknown): void {
    if (typeof obj === 'string') {
      RE.lastIndex = 0; let m: RegExpExecArray | null;
      while ((m = RE.exec(obj)) !== null) {
        if (!known.has(m[1])) continue;
        const k = `${m[1]}::${m[2]}`;
        if (!seen.has(k)) { seen.add(k); out.push({ srcRef: m[1], srcPath: m[2], srcShort: m[2].split('.').pop() ?? m[2] }); }
      }
    } else if (Array.isArray(obj)) obj.forEach(walk);
    else if (obj && typeof obj === 'object') Object.values(obj as Record<string, unknown>).forEach(walk);
  }
  walk(template); return out;
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
 * Tokenises a **bare** CEL expression (refs appear as `ref.path`, not `${ref.path}`).
 * Used when parsing the inner content of a single-`${}` CEL expression.
 */
export function parseCelExpr(inner: string, knownIds: Set<string>): Array<Omit<BuilderToken, 'id'>> {
  const s = inner.trim();
  if (!s) return [];

  // Top-level ternary?
  const ternary = findTopLevelTernary(s);
  if (ternary) {
    const mk = (part: string): BuilderToken[] =>
      parseCelExpr(part, knownIds).map((t, idx) => ({ ...t, id: `p${idx}` }));
    return [{ kind: 'conditional' as const, condTokens: mk(ternary.cond), thenTokens: mk(ternary.then_), elseTokens: mk(ternary.else_) }];
  }

  // Scan for refs (ref.path) and string literals ("...")
  const result: Array<Omit<BuilderToken, 'id'>> = [];
  let pos = 0;
  while (pos < s.length) {
    // "quoted string"
    if (s[pos] === '"') {
      let i = pos + 1;
      while (i < s.length) { if (s[i] === '\\') { i += 2; continue; } if (s[i] === '"') break; i++; }
      result.push({ kind: 'literal' as const, text: s.slice(pos + 1, i).replace(/\\"/g, '"').replace(/\\\\/g, '\\'), isString: true });
      pos = i + 1; continue;
    }
    // ref.path — identifier followed by dot, where identifier is a known ref
    const refM = /^([a-zA-Z_][a-zA-Z0-9_]*)\.(\??[a-zA-Z_][a-zA-Z0-9_.[\]]*)/.exec(s.slice(pos));
    if (refM && knownIds.has(refM[1])) {
      let path = refM[2]; let optional = false;
      if (path.startsWith('?')) { optional = true; path = path.slice(1); }
      const nodeId = refToNodeId(refM[1]);
      result.push({ kind: 'ref' as const, nodeRef: refM[1], nodeId, fieldPath: path, ...(optional && { optional: true }) });
      pos += refM[0].length; continue;
    }
    // Raw literal — consume until next ref boundary or string
    let end = pos + 1;
    while (end < s.length) {
      if (s[end] === '"') break;
      const ahead = /^([a-zA-Z_][a-zA-Z0-9_]*)\./.exec(s.slice(end));
      if (ahead && knownIds.has(ahead[1])) break;
      end++;
    }
    const text = s.slice(pos, end);
    if (text) result.push({ kind: 'literal' as const, text });
    pos = end;
  }
  return result;
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

/**
 * Parse a raw CEL template string back into BuilderTokens.
 *
 * Recognised patterns (in priority order):
 *   ${ref.path} / ${ref.?path}  → ref token
 *   (cond) ? (then) : (else)    → conditional token (recursive)
 *   "quoted string"             → literal token with isString=true
 *   anything else               → raw literal token
 */
export function tokensFromTemplate(template: string, knownIds: Set<string>): Array<Omit<BuilderToken, 'id'>> {
  if (!template) return [];
  const result: Array<Omit<BuilderToken, 'id'>> = [];
  let pos = 0;

  while (pos < template.length) {
    // 1. ${ref.path}, ${ref.?path}, or ${complex CEL expression}
    if (template.startsWith('${', pos)) {
      const closeIdx = findCelClose(template, pos + 2);
      if (closeIdx > 0) {
        const inner = template.slice(pos + 2, closeIdx);
        const dotIdx = inner.indexOf('.');
        // Simple ref.path — ref is known and path is a plain identifier (no spaces/operators)
        if (dotIdx > 0) {
          const ref = inner.slice(0, dotIdx);
          let path = inner.slice(dotIdx + 1);
          let optional = false;
          if (path.startsWith('?')) { optional = true; path = path.slice(1); }
          if (knownIds.has(ref) && isSimplePath(path)) {
            const nodeId = refToNodeId(ref);
            result.push({ kind: 'ref', nodeRef: ref, nodeId, fieldPath: path, ...(optional && { optional: true }) });
            pos = closeIdx + 1;
            continue;
          }
        }
        // Complex CEL expression — parse the inner content as bare CEL
        result.push(...parseCelExpr(inner, knownIds));
        pos = closeIdx + 1;
        continue;
      }
    }

    // 2. (cond) ? (then) : (else)
    if (template[pos] === '(') {
      const condGroup = extractGroup(template, pos);
      if (condGroup) {
        const afterCond = template.slice(condGroup.end);
        const qMatch = afterCond.match(/^\s*\?\s*/);
        if (qMatch) {
          const thenPos = condGroup.end + qMatch[0].length;
          const thenGroup = extractGroup(template, thenPos);
          if (thenGroup) {
            const afterThen = template.slice(thenGroup.end);
            const cMatch = afterThen.match(/^\s*:\s*/);
            if (cMatch) {
              const elsePos = thenGroup.end + cMatch[0].length;
              const elseGroup = extractGroup(template, elsePos);
              if (elseGroup) {
                const makeTokens = (part: string): BuilderToken[] =>
                  tokensFromTemplate(part, knownIds).map((t, i) => ({ ...t, id: `p${i}` }));
                result.push({
                  kind: 'conditional' as const,
                  condTokens: makeTokens(condGroup.inner),
                  thenTokens: makeTokens(thenGroup.inner),
                  elseTokens: makeTokens(elseGroup.inner),
                });
                pos = elseGroup.end;
                continue;
              }
            }
          }
        }
      }
    }

    // 3. "quoted string" → isString literal
    if (template[pos] === '"') {
      let i = pos + 1;
      while (i < template.length) {
        if (template[i] === '\\') { i += 2; continue; }
        if (template[i] === '"') break;
        i++;
      }
      const text = template.slice(pos + 1, i).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      result.push({ kind: 'literal' as const, text, isString: true });
      pos = i + 1;
      continue;
    }

    // 4. Raw literal — consume until next recognisable boundary
    let end = pos + 1;
    while (end < template.length) {
      const ch = template[end];
      if ((ch === '$' && template[end + 1] === '{') || ch === '(' || ch === '"') break;
      end++;
    }
    result.push({ kind: 'literal' as const, text: template.slice(pos, end) });
    pos = end;
  }

  return result;
}

/** Maps a conditional part name to its BuilderToken array field key. */
export function condPartField(part: 'cond' | 'then' | 'else'): 'condTokens' | 'thenTokens' | 'elseTokens' {
  return part === 'cond' ? 'condTokens' : part === 'then' ? 'thenTokens' : 'elseTokens';
}

/**
 * A "template-level" literal is plain separator text (`.`, `-`, `/`, …) that should
 * appear between `${…}` holes rather than inside a CEL expression.
 * Contrast with CEL operators (` == `, ` && `, …) which belong INSIDE the `${…}`.
 */
export function isTemplateLevel(t: BuilderToken): boolean {
  return t.kind === 'literal' && !t.isString && !CEL_OPS_SET.has(t.text ?? '');
}

/** Serialises tokens as a bare CEL expression (refs become `ref.path`, no `${}`). */
export function tokensToCelInner(tokens: BuilderToken[]): string {
  return tokens.map(t => {
    if (t.kind === 'ref') return `${t.nodeRef}.${t.optional ? '?' : ''}${t.fieldPath}`;
    if (t.kind === 'conditional') {
      const c  = tokensToCelInner(t.condTokens ?? []);
      const th = tokensToCelInner(t.thenTokens ?? []);
      const el = tokensToCelInner(t.elseTokens ?? []);
      return `${c} ? ${th} : ${el}`;
    }
    if (t.isString) return `"${(t.text ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    return t.text ?? '';
  }).join('');
}

/** True when a run of tokens contains any CEL operator or conditional. */
export function isCelMode(tokens: BuilderToken[]): boolean {
  return tokens.some(t =>
    t.kind === 'conditional' ||
    (t.kind === 'literal' && !t.isString && CEL_OPS_SET.has(t.text ?? ''))
  );
}

/** Returns the CEL-mode runs from a token sequence (sliced at template-level literals). */
export function getCelClusters(tokens: BuilderToken[]): BuilderToken[][] {
  const clusters: BuilderToken[][] = [];
  let run: BuilderToken[] = [];
  for (const t of tokens) {
    if (isTemplateLevel(t)) { if (run.length && isCelMode(run)) clusters.push(run); run = []; }
    else run.push(t);
  }
  if (run.length && isCelMode(run)) clusters.push(run);
  return clusters;
}

/**
 * Serialises BuilderTokens to a CEL template string.
 *
 * Template-level literals (`.`, `-`, …) split the sequence into **runs**.
 * Runs containing CEL operators / conditionals → single `${celExpr}` hole.
 * Pure ref+isString runs                       → multi-hole `${ref}text${ref}`.
 *
 * Example: [ref1, lit("."), ref2, lit(" && "), ref3]
 *   run1=[ref1]              → ${ref1.path}
 *   sep="."                 → .
 *   run2=[ref2, &&, ref3]   → ${ref2.path && ref3.path}
 *   result: "${ref1.path}.${ref2.path && ref3.path}"
 */
export function tokensToTemplate(tokens: BuilderToken[]): string {
  if (!tokens.length) return '';

  type Chunk = { run: BuilderToken[] } | { sep: string };
  const chunks: Chunk[] = [];
  let run: BuilderToken[] = [];
  for (const t of tokens) {
    if (isTemplateLevel(t)) { if (run.length) { chunks.push({ run }); run = []; } chunks.push({ sep: t.text ?? '' }); }
    else run.push(t);
  }
  if (run.length) chunks.push({ run });

  return chunks.map(c => {
    if ('sep' in c) return c.sep;
    if (isCelMode(c.run)) return `\${${tokensToCelInner(c.run)}}`;
    return c.run.map(t =>
      t.kind === 'ref' ? `\${${t.nodeRef}.${t.optional ? '?' : ''}${t.fieldPath}}` : (t.text ?? '')
    ).join('');
  }).join('');
}

/**
 * Type compatibility between a source field type and the target field type.
 * 'ok'           → types match or are both numeric
 * 'coerce'       → target is string, source is not — usually safe with string()
 * 'incompatible' → types differ in a way that will likely cause a CEL runtime error
 */
export function typeCompatibility(srcType: string | undefined, tgtType: string | undefined): TypeCompat {
  if (!srcType || !tgtType || srcType === tgtType || tgtType === 'any' || srcType === 'any') return 'ok';
  const numeric = new Set(['integer', 'number']);
  if (numeric.has(srcType) && numeric.has(tgtType)) return 'ok';
  if (tgtType === 'string') return 'coerce';
  return 'incompatible';
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
  const CEL_RE = celInterpRe();
  let mm: RegExpExecArray | null;
  let hasKnownRef = false;
  while ((mm = CEL_RE.exec(template)) !== null) {
    if (knownIds.has(mm[1])) { hasKnownRef = true; break; }
  }
  if (hasKnownRef) return { ...base, segments: parseSegments(template, knownIds) };
  if (/\$\{/.test(template)) return { ...base, celExpr: template };
  return { ...base, value: template };
}
