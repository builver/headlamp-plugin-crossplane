import { FieldSuggestion } from './types';

/**
 * Inline-resolves JSON Schema `$ref` pointers and merges `allOf` schemas using the sibling
 * `components.schemas` dict. Stops at `maxDepth` and breaks cycles with `{ type: 'object' }`.
 *
 * K8s OpenAPI v3 wraps refs as `allOf: [{ $ref: '...' }]` to allow sibling keywords — this
 * function merges those resolved properties back into the parent so that `flattenJsonSchema`
 * can see the full field tree (e.g. Deployment spec → replicas, selector, template, …).
 */
export function resolveSchemaRefs(obj: any, schemas: Record<string, any>, maxDepth = 6, seen = new Set<string>()): any {
  if (!obj || typeof obj !== 'object' || maxDepth <= 0) return obj;
  if (Array.isArray(obj)) return obj.map(v => resolveSchemaRefs(v, schemas, maxDepth, seen));
  if (typeof obj.$ref === 'string') {
    const name = (obj.$ref as string).replace('#/components/schemas/', '');
    if (seen.has(name)) return { type: 'object' };
    const target = schemas[name];
    if (!target) return obj;
    return resolveSchemaRefs(target, schemas, maxDepth - 1, new Set([...seen, name]));
  }
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k !== 'allOf') out[k] = resolveSchemaRefs(v, schemas, maxDepth, seen);
  }
  if (Array.isArray(obj.allOf)) {
    for (const sub of obj.allOf) {
      const resolved = resolveSchemaRefs(sub, schemas, maxDepth - 1, seen);
      if (resolved.properties) out.properties = { ...resolved.properties, ...out.properties };
      if (resolved.type && !out.type) out.type = resolved.type;
    }
  }
  return out;
}

/** Extracts apiVersion from any resource entry (template, externalRef, or bare pending resource). */
export function getResApiVersion(res: unknown): string {
  return (res as any)?.template?.apiVersion ?? (res as any)?.externalRef?.apiVersion ?? (res as any)?.apiVersion ?? '';
}
/** Extracts kind from any resource entry (template, externalRef, or bare pending resource). */
export function getResKind(res: unknown): string {
  return (res as any)?.template?.kind ?? (res as any)?.externalRef?.kind ?? (res as any)?.kind ?? '';
}

/** Returns dot-paths that are map types (additionalProperties, no fixed properties) in the schema. */
export function findMapPaths(schema: any, prefix = '', maxDepth = 6): Set<string> {
  const result = new Set<string>();
  if (!schema?.properties || maxDepth <= 0) return result;
  for (const [key, val] of Object.entries(schema.properties as Record<string, any>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val.additionalProperties !== undefined && !val.properties) {
      result.add(path);
    } else if (val.properties) {
      for (const p of findMapPaths(val, path, maxDepth - 1)) result.add(p);
    }
  }
  return result;
}

/** Returns dot-paths that are array types (items present) in the schema. */
export function findArrayPaths(schema: any, prefix = '', maxDepth = 6): Set<string> {
  const result = new Set<string>();
  if (!schema?.properties || maxDepth <= 0) return result;
  for (const [key, val] of Object.entries(schema.properties as Record<string, any>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (val.type === 'array' && val.items) {
      result.add(path);
    }
    if (val.properties) {
      for (const p of findArrayPaths(val, path, maxDepth - 1)) result.add(p);
    }
    if (val.type === 'array' && val.items?.properties) {
      for (const p of findArrayPaths(val.items, `${path}[]`, maxDepth - 1)) result.add(p);
    }
  }
  return result;
}

export function flattenJsonSchema(schema: any, prefix = '', maxDepth = 6): FieldSuggestion[] {
  if (!schema?.properties || maxDepth <= 0) return [];
  const result: FieldSuggestion[] = [];
  for (const [key, val] of Object.entries(schema.properties as Record<string, any>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    // Map types (additionalProperties, no fixed properties) get 'map' so the isLeaf filter
    // in getSuggestions passes them through — they ARE usable fields, just free-keyed.
    const isMapField = val.additionalProperties !== undefined && !val.properties;
    const type = isMapField ? 'map' : (val.type ?? (val.properties ? 'object' : val.items ? 'array' : 'any'));
    result.push({ path, type });
    if (val.properties) result.push(...flattenJsonSchema(val, path, maxDepth - 1));
    if (val.items?.properties) result.push(...flattenJsonSchema(val.items, `${path}[]`, maxDepth - 1));
  }
  return result;
}
