import { describe, expect, it } from 'vitest';
import {
  AstBinary,
  AstCall,
  AstRef,
  AstTernary,
  CelNode,
  celNodeToCelInner,
  celTemplateToString,
  findCelClose,
  findCelRefs,
  findTopLevelTernary,
  isSimplePath,
  overlayRowWithTemplate,
  parseCelAst,
  parseCelTemplate,
  parseSegments,
  reconstructTemplate,
  setSegmentOptional,
  shortFieldName,
  splitSrcPath,
  validateCelInner,
} from './celUtils';
import { NodeRow } from './types';

// Most CEL the kro graph parses uses these well-known ids; tests share a default set.
const KNOWN = new Set(['schema', 'env', 'res1', 'res2']);

// ─────────────────────────────────────────────────────────────────────────────
// parseCelAst — references
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCelAst — references', () => {
  it('parses a bare known ref into an empty-path ref node', () => {
    const ast = parseCelAst('schema', KNOWN);
    expect(ast).toEqual({ kind: 'ref', nodeRef: 'schema', fieldPath: '', optional: false });
  });

  it('parses a ref with a single field segment', () => {
    expect(parseCelAst('schema.spec', KNOWN)).toEqual({
      kind: 'ref', nodeRef: 'schema', fieldPath: 'spec', optional: false,
    });
  });

  it('parses a ref with a deep field path', () => {
    expect(parseCelAst('schema.spec.forProvider.region', KNOWN)).toEqual({
      kind: 'ref', nodeRef: 'schema', fieldPath: 'spec.forProvider.region', optional: false,
    });
  });

  it('parses an optional chain via `?.` and marks the ref optional', () => {
    const ast = parseCelAst('schema.spec?.foo', KNOWN) as AstRef;
    expect(ast.kind).toBe('ref');
    expect(ast.optional).toBe(true);
    expect(ast.fieldPath).toBe('spec.?foo');
  });

  it('parses dot-optional `.?ident` (kro flavor) the same way', () => {
    const ast = parseCelAst('schema.?spec', KNOWN) as AstRef;
    expect(ast.kind).toBe('ref');
    expect(ast.optional).toBe(true);
    expect(ast.fieldPath).toBe('?spec');
  });

  it('propagates optional through subsequent path segments', () => {
    const ast = parseCelAst('schema.?spec.?foo.bar', KNOWN) as AstRef;
    expect(ast.optional).toBe(true);
    expect(ast.fieldPath).toBe('?spec.?foo.bar');
  });

  it('unknown identifier resolves to a raw node', () => {
    expect(parseCelAst('unknownThing', KNOWN)).toEqual({ kind: 'raw', text: 'unknownThing' });
  });

  it('all three well-known ref roots parse as refs', () => {
    expect((parseCelAst('env.items', KNOWN) as AstRef).nodeRef).toBe('env');
    expect((parseCelAst('res1.status', KNOWN) as AstRef).nodeRef).toBe('res1');
    expect((parseCelAst('res2.metadata.name', KNOWN) as AstRef).nodeRef).toBe('res2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCelAst — literals
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCelAst — literals', () => {
  it('parses a double-quoted string', () => {
    expect(parseCelAst('"hello"', KNOWN)).toEqual({ kind: 'literal', value: 'hello', valueType: 'string' });
  });

  it('parses a single-quoted string', () => {
    expect(parseCelAst("'hi'", KNOWN)).toEqual({ kind: 'literal', value: 'hi', valueType: 'string' });
  });

  it('handles escaped quotes inside a string literal', () => {
    expect(parseCelAst('"he said \\"hi\\""', KNOWN)).toEqual({
      kind: 'literal', value: 'he said "hi"', valueType: 'string',
    });
  });

  it('parses an integer literal', () => {
    expect(parseCelAst('42', KNOWN)).toEqual({ kind: 'literal', value: '42', valueType: 'number' });
  });

  it('parses a decimal literal', () => {
    expect(parseCelAst('3.14', KNOWN)).toEqual({ kind: 'literal', value: '3.14', valueType: 'number' });
  });

  it('parses `true` / `false` as boolean literals', () => {
    expect(parseCelAst('true', KNOWN)).toEqual({ kind: 'literal', value: 'true', valueType: 'boolean' });
    expect(parseCelAst('false', KNOWN)).toEqual({ kind: 'literal', value: 'false', valueType: 'boolean' });
  });

  it('parses `null` as a null literal', () => {
    expect(parseCelAst('null', KNOWN)).toEqual({ kind: 'literal', value: 'null', valueType: 'null' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCelAst — binary / unary / precedence
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCelAst — binary operators', () => {
  it('parses `==` into a binary node', () => {
    const ast = parseCelAst('a == 1', new Set(['a'])) as AstBinary;
    expect(ast.kind).toBe('binary');
    expect(ast.op).toBe('==');
    expect(ast.left).toEqual({ kind: 'ref', nodeRef: 'a', fieldPath: '', optional: false });
    expect(ast.right).toEqual({ kind: 'literal', value: '1', valueType: 'number' });
  });

  it('parses `+` `-` as binary ops', () => {
    expect((parseCelAst('1 + 2', KNOWN) as AstBinary).op).toBe('+');
    expect((parseCelAst('5 - 3', KNOWN) as AstBinary).op).toBe('-');
  });

  it('parses comparison operators', () => {
    for (const op of ['<', '>', '<=', '>=']) {
      const ast = parseCelAst(`schema.x ${op} 0`, KNOWN) as AstBinary;
      expect(ast.kind).toBe('binary');
      expect(ast.op).toBe(op);
    }
  });

  it('treats `&&` as higher precedence than `||` (so a || b && c parses as a || (b && c))', () => {
    const ast = parseCelAst('a || b && c', new Set(['a', 'b', 'c'])) as AstBinary;
    expect(ast.kind).toBe('binary');
    expect(ast.op).toBe('||');
    expect((ast.right as AstBinary).op).toBe('&&');
  });

  it('treats `==` as higher precedence than `&&`', () => {
    const ast = parseCelAst('a == 1 && b == 2', new Set(['a', 'b'])) as AstBinary;
    expect(ast.op).toBe('&&');
    expect((ast.left as AstBinary).op).toBe('==');
    expect((ast.right as AstBinary).op).toBe('==');
  });

  it('treats `*` `/` as higher precedence than `+` `-`', () => {
    const ast = parseCelAst('1 + 2 * 3', KNOWN) as AstBinary;
    expect(ast.op).toBe('+');
    expect((ast.right as AstBinary).op).toBe('*');
  });

  it('parses left-associative chains correctly (a - b - c → (a - b) - c)', () => {
    const ast = parseCelAst('10 - 3 - 2', KNOWN) as AstBinary;
    expect(ast.op).toBe('-');
    expect((ast.left as AstBinary).op).toBe('-');
    expect((ast.left as AstBinary).left).toEqual({ kind: 'literal', value: '10', valueType: 'number' });
    expect(ast.right).toEqual({ kind: 'literal', value: '2', valueType: 'number' });
  });

  it('parentheses override precedence', () => {
    const ast = parseCelAst('(1 + 2) * 3', KNOWN) as AstBinary;
    expect(ast.op).toBe('*');
    expect((ast.left as AstBinary).op).toBe('+');
  });
});

describe('parseCelAst — unary', () => {
  it('parses `!x` into a unary node', () => {
    const ast = parseCelAst('!schema.flag', KNOWN);
    expect(ast).toMatchObject({ kind: 'unary', op: '!' });
  });

  it('parses double negation', () => {
    const ast = parseCelAst('!!schema.flag', KNOWN) as { kind: 'unary'; operand: CelNode };
    expect(ast.kind).toBe('unary');
    expect(ast.operand).toMatchObject({ kind: 'unary', op: '!' });
  });

  it('applies unary to a parenthesized expression', () => {
    const ast = parseCelAst('!(a || b)', new Set(['a', 'b'])) as { kind: 'unary'; operand: AstBinary };
    expect(ast.kind).toBe('unary');
    expect(ast.operand.kind).toBe('binary');
    expect(ast.operand.op).toBe('||');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCelAst — ternary
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCelAst — ternary', () => {
  it('parses `cond ? then : else`', () => {
    const ast = parseCelAst('a == 1 ? "x" : "y"', new Set(['a'])) as AstTernary;
    expect(ast.kind).toBe('ternary');
    expect((ast.cond as AstBinary).op).toBe('==');
    expect(ast.then_).toEqual({ kind: 'literal', value: 'x', valueType: 'string' });
    expect(ast.else_).toEqual({ kind: 'literal', value: 'y', valueType: 'string' });
  });

  it('parses ternary nested in the then branch', () => {
    const ast = parseCelAst('a ? (b ? "x" : "y") : "z"', new Set(['a', 'b'])) as AstTernary;
    expect(ast.kind).toBe('ternary');
    expect((ast.then_ as AstTernary).kind).toBe('ternary');
  });

  it('parses ternary right-associatively (a ? b : c ? d : e parses as a ? b : (c ? d : e))', () => {
    const ast = parseCelAst('a ? b : c ? d : e', new Set(['a', 'b', 'c', 'd', 'e'])) as AstTernary;
    expect(ast.kind).toBe('ternary');
    expect((ast.else_ as AstTernary).kind).toBe('ternary');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCelAst — calls
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCelAst — calls', () => {
  it('parses a global zero-arg call', () => {
    const ast = parseCelAst('now()', KNOWN) as AstCall;
    expect(ast.kind).toBe('call');
    expect(ast.name).toBe('now');
    expect(ast.receiver).toBeNull();
    expect(ast.args).toEqual([]);
  });

  it('parses a global call with multiple args', () => {
    const ast = parseCelAst('max(1, 2, 3)', KNOWN) as AstCall;
    expect(ast.name).toBe('max');
    expect(ast.args).toHaveLength(3);
    expect(ast.args[0]).toEqual({ kind: 'literal', value: '1', valueType: 'number' });
  });

  it('parses `has(schema.spec.x)` with a ref arg', () => {
    const ast = parseCelAst('has(schema.spec.x)', KNOWN) as AstCall;
    expect(ast.name).toBe('has');
    expect(ast.args[0]).toMatchObject({ kind: 'ref', nodeRef: 'schema', fieldPath: 'spec.x' });
  });

  it('parses a receiver method call: `s.foo.replace("a", "b")`', () => {
    const ast = parseCelAst('schema.foo.replace("a", "b")', KNOWN) as AstCall;
    expect(ast.kind).toBe('call');
    expect(ast.name).toBe('replace');
    expect(ast.receiver).toMatchObject({ kind: 'ref', nodeRef: 'schema', fieldPath: 'foo' });
    expect(ast.args).toHaveLength(2);
  });

  it('parses chained method calls', () => {
    const ast = parseCelAst('schema.s.lower().upper()', KNOWN) as AstCall;
    expect(ast.kind).toBe('call');
    expect(ast.name).toBe('upper');
    expect((ast.receiver as AstCall).kind).toBe('call');
    expect((ast.receiver as AstCall).name).toBe('lower');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCelAst — index access and edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCelAst — edge cases', () => {
  it('empty input → empty raw', () => {
    expect(parseCelAst('', KNOWN)).toEqual({ kind: 'raw', text: '' });
  });

  it('whitespace-only input → empty raw', () => {
    expect(parseCelAst('   ', KNOWN)).toEqual({ kind: 'raw', text: '' });
  });

  it('trailing junk after a complete expression → whole input becomes raw', () => {
    // "a + b ! garbage" — `!` is a prefix op but follows another expression, so trailing junk remains
    expect(parseCelAst('schema 1', KNOWN)).toMatchObject({ kind: 'raw' });
  });

  it('whitespace inside expressions is tolerated', () => {
    const a = parseCelAst('1+2', KNOWN);
    const b = parseCelAst('  1  +  2  ', KNOWN);
    expect(a).toEqual(b);
  });

  it('array literal is captured as raw text verbatim', () => {
    const ast = parseCelAst('[1, 2, 3]', KNOWN);
    expect(ast.kind).toBe('raw');
  });

  it('index access on a ref produces a raw fallback', () => {
    const ast = parseCelAst('schema.items[0]', KNOWN);
    expect(ast.kind).toBe('raw');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseCelTemplate
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCelTemplate', () => {
  it('returns empty array for empty input', () => {
    expect(parseCelTemplate('', KNOWN)).toEqual([]);
  });

  it('treats a pure text template as one text segment', () => {
    expect(parseCelTemplate('plain text', KNOWN)).toEqual([{ kind: 'text', text: 'plain text' }]);
  });

  it('parses a single `${…}` as one interp segment', () => {
    const t = parseCelTemplate('${schema.spec.foo}', KNOWN);
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe('interp');
  });

  it('interleaves text and interp segments', () => {
    const t = parseCelTemplate('prefix-${schema.spec.foo}-suffix', KNOWN);
    expect(t).toHaveLength(3);
    expect(t[0]).toEqual({ kind: 'text', text: 'prefix-' });
    expect(t[1].kind).toBe('interp');
    expect(t[2]).toEqual({ kind: 'text', text: '-suffix' });
  });

  it('parses multiple consecutive interpolations', () => {
    const t = parseCelTemplate('${schema.a}${env.b}', KNOWN);
    expect(t).toHaveLength(2);
    expect(t[0].kind).toBe('interp');
    expect(t[1].kind).toBe('interp');
  });

  it('treats an unterminated `${` as plain text', () => {
    const t = parseCelTemplate('hello ${schema.unclosed', KNOWN);
    expect(t.every(s => s.kind === 'text')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// celNodeToCelInner — serialization & paren insertion
// ─────────────────────────────────────────────────────────────────────────────

describe('celNodeToCelInner', () => {
  it('serializes a bare ref', () => {
    expect(celNodeToCelInner({ kind: 'ref', nodeRef: 'schema', fieldPath: '', optional: false })).toBe('schema');
  });

  it('serializes a ref with a field path', () => {
    expect(celNodeToCelInner({ kind: 'ref', nodeRef: 'schema', fieldPath: 'spec.foo', optional: false }))
      .toBe('schema.spec.foo');
  });

  it('serializes a string literal with escaped quotes', () => {
    expect(celNodeToCelInner({ kind: 'literal', value: 'he said "hi"', valueType: 'string' }))
      .toBe('"he said \\"hi\\""');
  });

  it('does NOT add parens for same-precedence left arm (left-assoc preserved)', () => {
    // (a - b) - c serializes to "a - b - c" — left arm of `-` at prec 6, parent prec 6, no parens.
    const ast: CelNode = {
      kind: 'binary', op: '-',
      left:  { kind: 'binary', op: '-',
        left:  { kind: 'literal', value: 'a', valueType: 'string' },
        right: { kind: 'literal', value: 'b', valueType: 'string' } },
      right: { kind: 'literal', value: 'c', valueType: 'string' },
    };
    expect(celNodeToCelInner(ast)).toBe('"a" - "b" - "c"');
  });

  it('ADDS parens for same-precedence right arm (right-assoc needs grouping)', () => {
    // a - (b - c) must serialize with parens.
    const ast: CelNode = {
      kind: 'binary', op: '-',
      left:  { kind: 'literal', value: 'a', valueType: 'string' },
      right: { kind: 'binary', op: '-',
        left:  { kind: 'literal', value: 'b', valueType: 'string' },
        right: { kind: 'literal', value: 'c', valueType: 'string' } },
    };
    expect(celNodeToCelInner(ast)).toBe('"a" - ("b" - "c")');
  });

  it('parenthesizes a lower-precedence binary inside a higher-precedence parent', () => {
    // (1 + 2) * 3 — `+` (prec 6) under `*` (prec 7) needs parens
    const ast: CelNode = {
      kind: 'binary', op: '*',
      left:  { kind: 'binary', op: '+',
        left:  { kind: 'literal', value: '1', valueType: 'number' },
        right: { kind: 'literal', value: '2', valueType: 'number' } },
      right: { kind: 'literal', value: '3', valueType: 'number' },
    };
    expect(celNodeToCelInner(ast)).toBe('(1 + 2) * 3');
  });

  it('parenthesizes a ternary embedded inside a binary', () => {
    const ast: CelNode = {
      kind: 'binary', op: '+',
      left:  { kind: 'ternary',
        cond:  { kind: 'literal', value: 'true',  valueType: 'boolean' },
        then_: { kind: 'literal', value: '1', valueType: 'number' },
        else_: { kind: 'literal', value: '2', valueType: 'number' } },
      right: { kind: 'literal', value: '3', valueType: 'number' },
    };
    expect(celNodeToCelInner(ast)).toBe('(true ? 1 : 2) + 3');
  });

  it('serializes global vs receiver calls correctly', () => {
    expect(celNodeToCelInner({ kind: 'call', name: 'size', receiver: null,
      args: [{ kind: 'ref', nodeRef: 'env', fieldPath: 'items', optional: false }] }))
      .toBe('size(env.items)');
    expect(celNodeToCelInner({ kind: 'call', name: 'lower',
      receiver: { kind: 'ref', nodeRef: 'schema', fieldPath: 'x', optional: false }, args: [] }))
      .toBe('schema.x.lower()');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: parseCelAst → celNodeToCelInner → parseCelAst
// ─────────────────────────────────────────────────────────────────────────────

describe('round-trip: parseCelAst ↔ celNodeToCelInner', () => {
  const cases: string[] = [
    'schema',
    'schema.spec.foo',
    'schema.spec.?foo',
    '?schema',
    'schema.spec == "x"',
    '"hello"',
    '42',
    '3.14',
    'true',
    'null',
    'a && b || c',
    'a || b && c',
    '1 + 2 * 3',
    '(1 + 2) * 3',
    '10 - 3 - 2',
    'a == b ? "yes" : "no"',
    'a ? b : c ? d : e',
    '!schema.flag',
    'has(schema.spec.x)',
    'size(env.items)',
    'schema.s.lower()',
    'schema.s.replace("a", "b").upper()',
    'schema.count > 0',
    'schema.count >= 0 && schema.count <= 10',
  ];

  for (const expr of cases) {
    it(`round-trips: ${expr}`, () => {
      const known = new Set(['schema', 'env', 'res1', 'res2', 'a', 'b', 'c', 'd', 'e']);
      const ast1 = parseCelAst(expr, known);
      const serialized = celNodeToCelInner(ast1);
      const ast2 = parseCelAst(serialized, known);
      expect(ast2).toEqual(ast1);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Round-trip: parseCelTemplate → celTemplateToString
// ─────────────────────────────────────────────────────────────────────────────

describe('round-trip: parseCelTemplate ↔ celTemplateToString', () => {
  const cases: string[] = [
    'plain text',
    '${schema.spec.foo}',
    'prefix-${schema.spec.foo}-suffix',
    '${schema.a}-${env.b}',
    '${schema.spec.x == "y" ? "match" : "no"}',
    '${size(env.items)}',
  ];
  for (const tpl of cases) {
    it(`round-trips: ${tpl}`, () => {
      expect(celTemplateToString(parseCelTemplate(tpl, KNOWN))).toBe(tpl);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Auxiliary helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('findCelClose', () => {
  it('returns the index of the matching closing brace', () => {
    expect(findCelClose('${abc}', 2)).toBe(5);
  });

  it('skips `}` inside double-quoted strings', () => {
    expect(findCelClose('${"a}b"}', 2)).toBe(7);
  });

  it('skips `}` inside single-quoted strings', () => {
    expect(findCelClose("${'a}b'}", 2)).toBe(7);
  });

  it('handles backslash-escaped characters inside a string', () => {
    expect(findCelClose('${"a\\"b}c"}', 2)).toBe(10);
  });

  it('returns -1 when no closing brace exists', () => {
    expect(findCelClose('${abc', 2)).toBe(-1);
  });
});

describe('findTopLevelTernary', () => {
  it('splits a simple ternary on the top-level `?` and `:`', () => {
    expect(findTopLevelTernary('a == 1 ? "x" : "y"')).toEqual({
      cond: 'a == 1', then_: '"x"', else_: '"y"',
    });
  });

  it('returns null when there is no `?`', () => {
    expect(findTopLevelTernary('a + b')).toBeNull();
  });

  it('skips a `?` that appears inside a string literal', () => {
    expect(findTopLevelTernary('"why?" + x')).toBeNull();
  });

  it('skips a `?` that appears inside parentheses', () => {
    // Outer ?: is what matters; inner (a ? b : c) should be ignored.
    const got = findTopLevelTernary('(a ? b : c) ? d : e');
    expect(got).toEqual({ cond: '(a ? b : c)', then_: 'd', else_: 'e' });
  });
});

describe('validateCelInner', () => {
  it('returns null for a valid expression', () => {
    expect(validateCelInner('schema.spec.foo == "x"')).toBeNull();
  });

  it('flags an empty expression', () => {
    expect(validateCelInner('')).toBe('empty expression');
    expect(validateCelInner('   ')).toBe('empty expression');
  });

  it('flags unbalanced parentheses', () => {
    expect(validateCelInner('(a + b')).toBe('unbalanced parentheses');
    expect(validateCelInner('a + b)')).toBe('unbalanced parentheses');
  });

  it('flags an unclosed string literal', () => {
    expect(validateCelInner('"hello')).toBe('unclosed string literal');
  });

  it('flags an expression that starts with an operator', () => {
    expect(validateCelInner('== 1')).toMatch(/starts with an operator/);
  });

  it('flags an expression that ends with an operator', () => {
    expect(validateCelInner('a &&')).toMatch(/ends with an operator/);
  });
});

describe('isSimplePath', () => {
  it('accepts simple dot paths', () => {
    expect(isSimplePath('spec')).toBe(true);
    expect(isSimplePath('spec.forProvider.region')).toBe(true);
  });

  it('accepts optional segments', () => {
    expect(isSimplePath('spec.?foo')).toBe(true);
    expect(isSimplePath('?spec.?foo.bar')).toBe(true);
  });

  it('rejects paths with operators or spaces', () => {
    expect(isSimplePath('spec.foo == "x"')).toBe(false);
    expect(isSimplePath('spec.foo + 1')).toBe(false);
    expect(isSimplePath('spec foo')).toBe(false);
  });

  it('rejects bracket / call syntax', () => {
    expect(isSimplePath('spec.items[0]')).toBe(false);
    expect(isSimplePath('spec.foo()')).toBe(false);
  });
});

describe('shortFieldName', () => {
  it('returns the last segment of a dot-path', () => {
    expect(shortFieldName('spec.forProvider.region')).toBe('region');
    expect(shortFieldName('foo')).toBe('foo');
  });
});

describe('splitSrcPath', () => {
  it('returns empty for empty input', () => {
    expect(splitSrcPath('')).toEqual([]);
  });

  it('splits a bare path with no optionals', () => {
    expect(splitSrcPath('spec.foo.bar')).toEqual([
      { name: 'spec', optional: false },
      { name: 'foo',  optional: false },
      { name: 'bar',  optional: false },
    ]);
  });

  it('marks a leading-? segment as optional', () => {
    expect(splitSrcPath('?spec.foo')).toEqual([
      { name: 'spec', optional: true  },
      { name: 'foo',  optional: false },
    ]);
  });

  it('marks mid-path and trailing optionals', () => {
    expect(splitSrcPath('spec.?foo.?bar')).toEqual([
      { name: 'spec', optional: false },
      { name: 'foo',  optional: true  },
      { name: 'bar',  optional: true  },
    ]);
  });

  it('round-trips through join', () => {
    const path = '?spec.?foo.bar';
    const rebuilt = splitSrcPath(path).map(s => (s.optional ? '?' : '') + s.name).join('.');
    expect(rebuilt).toBe(path);
  });

  it('silently drops empty-name segments from malformed paths', () => {
    expect(splitSrcPath('a..b')).toEqual([
      { name: 'a', optional: false },
      { name: 'b', optional: false },
    ]);
    expect(splitSrcPath('.foo')).toEqual([{ name: 'foo', optional: false }]);
    expect(splitSrcPath('a.')).toEqual([{ name: 'a', optional: false }]);
    expect(splitSrcPath('?')).toEqual([]);
    expect(splitSrcPath('a.?.b')).toEqual([
      { name: 'a', optional: false },
      { name: 'b', optional: false },
    ]);
  });
});

describe('setSegmentOptional', () => {
  it('adds ? to a segment that was not optional', () => {
    expect(setSegmentOptional('spec.foo.bar', 0, true)).toBe('?spec.foo.bar');
    expect(setSegmentOptional('spec.foo.bar', 1, true)).toBe('spec.?foo.bar');
    expect(setSegmentOptional('spec.foo.bar', 2, true)).toBe('spec.foo.?bar');
  });

  it('removes ? from a segment that was optional', () => {
    expect(setSegmentOptional('?spec.?foo.?bar', 0, false)).toBe('spec.?foo.?bar');
    expect(setSegmentOptional('?spec.?foo.?bar', 1, false)).toBe('?spec.foo.?bar');
    expect(setSegmentOptional('?spec.?foo.?bar', 2, false)).toBe('?spec.?foo.bar');
  });

  it('preserves intermediate ? markers when toggling another segment', () => {
    expect(setSegmentOptional('?spec.bar', 1, true)).toBe('?spec.?bar');
    expect(setSegmentOptional('?spec.?bar', 1, false)).toBe('?spec.bar');
  });

  it('is idempotent — setting the same value twice equals once', () => {
    const path = '?spec.?foo.bar';
    const once = setSegmentOptional(path, 2, true);
    const twice = setSegmentOptional(once, 2, true);
    expect(twice).toBe(once);
    expect(once).toBe('?spec.?foo.?bar');
  });

  it('returns input unchanged when idx is out of range', () => {
    expect(setSegmentOptional('spec.foo', -1, true)).toBe('spec.foo');
    expect(setSegmentOptional('spec.foo',  2, true)).toBe('spec.foo');
  });

  it('returns input unchanged when value already matches', () => {
    const path = '?spec.foo';
    expect(setSegmentOptional(path, 0, true)).toBe(path);
    expect(setSegmentOptional(path, 1, false)).toBe(path);
  });

  it('handles single-segment paths at both polarities', () => {
    expect(setSegmentOptional('spec',  0, true)).toBe('?spec');
    expect(setSegmentOptional('?spec', 0, false)).toBe('spec');
  });
});

describe('overlayRowWithTemplate — forEach round-trip', () => {
  // A forEach row is built by parsing the resource template, then postProcessEachRefs
  // rewrites `inPort.ref` to the resource's node id and stashes the original CEL
  // identifier (e.g. `user`) in `inPort.origRef`. When the user toggles a segment
  // via the popover, GraphCanvas writes a template using `origRef ?? ref` — i.e.
  // the CEL identifier — and that template flows back through overlayRowWithTemplate.
  // The overlay must preserve the forEach rewrite so the pill keeps wiring back to
  // the resource node and the tooltip keeps showing the CEL identifier.
  const KNOWN_WITH_USER = new Set(['schema', 'env', 'res1', 'user']);

  const baseForEachRow: NodeRow = {
    depth: 1, key: 'name', isParent: false, fieldPath: 'spec.name',
    inPort: { ref: 'res1', srcPath: 'spec.foo', srcShort: 'foo', origRef: 'user' },
  };

  it('preserves origRef and the node-id ref when overlay template uses the same CEL identifier', () => {
    const overlayed = overlayRowWithTemplate(baseForEachRow, '${user.spec.?foo}', KNOWN_WITH_USER);
    expect(overlayed.inPort).toEqual({
      ref: 'res1', srcPath: 'spec.?foo', srcShort: 'foo', origRef: 'user',
    });
  });

  it('round-trips a toggle without dropping origRef on subsequent overlays', () => {
    const afterFirstToggle = overlayRowWithTemplate(baseForEachRow, '${user.spec.?foo}', KNOWN_WITH_USER);
    const afterSecondToggle = overlayRowWithTemplate(afterFirstToggle, '${user.spec.foo}', KNOWN_WITH_USER);
    expect(afterSecondToggle.inPort).toEqual({
      ref: 'res1', srcPath: 'spec.foo', srcShort: 'foo', origRef: 'user',
    });
  });

  it('drops origRef when the user rewires the row to a different CEL identifier', () => {
    const overlayed = overlayRowWithTemplate(baseForEachRow, '${schema.spec.foo}', KNOWN_WITH_USER);
    expect(overlayed.inPort).toEqual({
      ref: 'schema', srcPath: 'spec.foo', srcShort: 'foo',
    });
    expect(overlayed.inPort?.origRef).toBeUndefined();
  });
});

describe('findCelRefs', () => {
  it('collects refs from a flat string value', () => {
    const refs = findCelRefs('${schema.spec.foo}-${env.bar}', KNOWN);
    expect(refs.map(r => `${r.srcRef}.${r.srcPath}`).sort()).toEqual(['env.bar', 'schema.spec.foo']);
  });

  it('walks nested objects and arrays', () => {
    const refs = findCelRefs({
      a: '${schema.spec.x}',
      b: ['static', '${env.y}'],
      c: { d: '${res1.z}' },
    }, KNOWN);
    expect(refs.map(r => `${r.srcRef}.${r.srcPath}`).sort())
      .toEqual(['env.y', 'res1.z', 'schema.spec.x']);
  });

  it('returns an empty list when no refs are present', () => {
    expect(findCelRefs({ a: 'plain', b: 42, c: { d: null } }, KNOWN)).toEqual([]);
  });
});

describe('parseSegments → reconstructTemplate round-trip', () => {
  it('round-trips a single-ref template', () => {
    const t = '${schema.spec.foo}';
    expect(reconstructTemplate(parseSegments(t, KNOWN))).toBe(t);
  });

  it('round-trips a mixed text / cel template', () => {
    const t = 'a-${schema.x}-b-${env.y}-c';
    expect(reconstructTemplate(parseSegments(t, KNOWN))).toBe(t);
  });
});
