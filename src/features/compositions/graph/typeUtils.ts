import { TypeCompat } from './types';

const ABBREV: Record<string, string> = {
  string: 'str', integer: 'int', boolean: 'bool', number: 'num',
  object: 'obj', array: 'arr', any: 'any',
};

export function abbrevType(t: string | undefined): string {
  if (!t) return '?';
  return ABBREV[t.toLowerCase()] ?? t;
}

export function typeCompat(srcType: string | undefined, tgtType: string | undefined): TypeCompat {
  if (!srcType || !tgtType || srcType === 'any' || tgtType === 'any') return 'ok';
  const s = srcType.toLowerCase();
  const t = tgtType.toLowerCase();
  if (s === t) return 'ok';
  // kro auto-coerces scalar types to string
  if (t === 'string' && (s === 'integer' || s === 'number' || s === 'boolean')) return 'coerce';
  return 'incompatible';
}
