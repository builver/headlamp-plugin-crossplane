import { ApiProxy } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getGroupVersion } from '../../../components/map/apiPaths';
import { findArrayPaths, findMapPaths, findPreserveUnknownPaths, flattenJsonSchema, getResApiVersion, getResKind, resolveSchemaRefs } from './schemaUtils';
import { FieldSuggestion, PendingResource } from './types';

export interface CompositionSchemas {
  effectiveXrdSchema: any;
  xrdSchemaDone: boolean;
  schemaKind: string | null;
  schemaApiVersion: string | null;
  schemaAttemptedKeys: Set<string>;
  combinedSchemaMap: Map<string, any> | undefined;
  xrdAllFields: FieldSuggestion[];
  xrdLeafFields: FieldSuggestion[];
  mrdFieldsCache: Map<string, FieldSuggestion[]>;
  mrdMapPathsCache: Map<string, Set<string>>;
  mrdArrayPathsCache: Map<string, Set<string>>;
  mrdPreserveUnknownPathsCache: Map<string, Set<string>>;
}

export function useCompositionSchemas({
  compositionName,
  xrdSchema,
  mrdSchemaMap,
  input,
  pendingResources,
  requirements,
}: {
  compositionName: string;
  xrdSchema?: any;
  mrdSchemaMap?: Map<string, any>;
  input: any;
  pendingResources: PendingResource[];
  requirements?: any;
}): CompositionSchemas {
  const [fetchedXrdSchema,  setFetchedXrdSchema]  = useState<any>(null);
  const [xrdSchemaDone,     setXrdSchemaDone]     = useState(!!xrdSchema);
  const [schemaKind,        setSchemaKind]        = useState<string | null>(null);
  const [schemaApiVersion,  setSchemaApiVersion]  = useState<string | null>(null);
  const [schemaAttemptedKeys, setSchemaAttemptedKeys] = useState<Set<string>>(new Set());
  const [nativeSchemaMap,   setNativeSchemaMap]   = useState<Map<string, any>>(new Map());

  // ── Self-sufficient XRD schema fetch for schema-node autocomplete ─────────────
  // Fetches spec.compositeTypeRef from the Composition, then finds the matching XRD
  // to extract its openAPIV3Schema. The xrdSchema prop (from the parent) takes priority;
  // this serves as a self-contained fallback so autocomplete works in any context.
  useEffect(() => {
    let mounted = true;
    async function run() {
      try {
        const comp = await ApiProxy.request(`/apis/apiextensions.crossplane.io/v1/compositions/${compositionName}`);
        const typeRef = comp?.spec?.compositeTypeRef as { apiVersion?: string; kind?: string } | undefined;
        if (!typeRef?.apiVersion || !typeRef?.kind || !mounted) return;
        const { apiVersion, kind } = typeRef;
        if (mounted) { setSchemaKind(kind); setSchemaApiVersion(apiVersion); }
        const group = getGroupVersion(apiVersion)[0];
        const xrdList = await ApiProxy.request('/apis/apiextensions.crossplane.io/v1/compositeresourcedefinitions');
        const xrd = (xrdList?.items ?? []).find(
          (x: any) => x.spec?.names?.kind === kind && x.spec?.group === group
        );
        if (!xrd || !mounted) return;
        const versions: any[] = xrd.spec?.versions ?? [];
        const served = versions.find((v: any) => v.served !== false) ?? versions[0];
        const schema = served?.schema?.openAPIV3Schema ?? null;
        if (schema && mounted) setFetchedXrdSchema(schema);
      } catch (err) {
        console.warn('[crossplane] Failed to fetch XRD schema for autocomplete:', err);
      } finally {
        if (mounted) setXrdSchemaDone(true);
      }
    }
    run();
    return () => { mounted = false; };
  }, [compositionName]);

  const effectiveXrdSchema = xrdSchema ?? fetchedXrdSchema;
  // If the parent provides xrdSchema directly, mark as done immediately.
  // (The fetch effect only sets xrdSchemaDone after its async run completes.)
  if (xrdSchema && !xrdSchemaDone) setXrdSchemaDone(true);

  // ── Native K8s schema fetch ────────────────────────────────────────────────
  // Fetches OpenAPI v3 schemas for native K8s resources (Deployment, Service, …) that aren't
  // covered by the MRD schema map. Triggered whenever the set of group/version/kind triples
  // changes — including pending resources added in this session (before they are saved).

  const resourceGvKinds = useMemo(() => {
    const envReqs: any[] = (requirements ?? input?.requirements)?.requiredResources ?? [];
    return [
      ...(input?.resources ?? []).map((r: any) => `${getResApiVersion(r)}::${getResKind(r)}`),
      ...pendingResources.map((r: any) => `${getResApiVersion(r)}::${getResKind(r)}`),
      ...envReqs.map((r: any) => `${r.apiVersion ?? ''}::${r.kind ?? ''}`),
    ].filter(s => s !== '::').sort().join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input?.resources, pendingResources, requirements]);

  const mrdSchemaMapRef = useRef(mrdSchemaMap);
  useEffect(() => { mrdSchemaMapRef.current = mrdSchemaMap; });

  useEffect(() => {
    const allRes: any[] = [...(input?.resources ?? []), ...pendingResources];
    const gvToKinds = new Map<string, Array<{ mapKey: string; kind: string }>>();
    const seenMapKeys = new Set<string>();
    for (const res of allRes) {
      const apiVersion = getResApiVersion(res);
      const kind = getResKind(res);
      if (!apiVersion || !kind) continue;
      const [group, version] = getGroupVersion(apiVersion);
      const mapKey = `${group}/${kind}`;
      if (mrdSchemaMapRef.current?.has(mapKey) || seenMapKeys.has(mapKey)) continue;
      seenMapKeys.add(mapKey);
      const gvPath = group ? `apis/${group}/${version}` : `api/${version}`;
      if (!gvToKinds.has(gvPath)) gvToKinds.set(gvPath, []);
      gvToKinds.get(gvPath)!.push({ mapKey, kind });
    }
    for (const req of ((requirements ?? input?.requirements)?.requiredResources ?? []) as any[]) {
      const apiVersion = req.apiVersion as string | undefined;
      const kind = req.kind as string | undefined;
      if (!apiVersion || !kind) continue;
      const [group, version] = getGroupVersion(apiVersion);
      const mapKey = `${group}/${kind}`;
      if (mrdSchemaMapRef.current?.has(mapKey) || seenMapKeys.has(mapKey)) continue;
      seenMapKeys.add(mapKey);
      const gvPath = group ? `apis/${group}/${version}` : `api/${version}`;
      if (!gvToKinds.has(gvPath)) gvToKinds.set(gvPath, []);
      gvToKinds.get(gvPath)!.push({ mapKey, kind });
    }
    if (!gvToKinds.size) return;

    let mounted = true;
    const result = new Map<string, any>();
    Promise.allSettled(
      [...gvToKinds.entries()].map(async ([gvPath, entries]) => {
        let doc: any;
        try {
          doc = await ApiProxy.request(`/openapi/v3/${gvPath}`);
        } catch (err) {
          console.warn('[crossplane] schema fetch failed for', gvPath, err);
          return;
        }
        const schemas: Record<string, any> = doc?.components?.schemas ?? {};
        console.log('[crossplane] schema fetch', gvPath, 'schemas:', Object.keys(schemas).length, 'looking for:', entries.map(e => e.kind));
        for (const { mapKey, kind } of entries) {
          const schema = Object.values(schemas).find((s: any) =>
            (s['x-kubernetes-group-version-kind'] ?? []).some((gvk: any) => gvk.kind === kind)
          );
          console.log('[crossplane] schema for', mapKey, schema ? 'found, top-level keys:' : 'NOT FOUND', schema ? Object.keys(schema).join(',') : '');
          if (schema) {
            const resolved = resolveSchemaRefs(schema, schemas, 12);
            console.log('[crossplane] resolved', mapKey, 'properties:', Object.keys(resolved?.properties ?? {}));
            result.set(mapKey, resolved);
          }
        }
      })
    ).then(() => {
      console.log('[crossplane] schema fetch done, result keys:', [...result.keys()]);
      if (!mounted) return;
      setSchemaAttemptedKeys(prev => {
        const next = new Set(prev);
        let changed = false;
        for (const entries of gvToKinds.values()) {
          for (const { mapKey } of entries) {
            if (!next.has(mapKey)) { next.add(mapKey); changed = true; }
          }
        }
        return changed ? next : prev;
      });
      if (!result.size) return;
      setNativeSchemaMap(prev => {
        const merged = new Map(prev);
        let changed = false;
        for (const [k, v] of result) { if (!merged.has(k)) { merged.set(k, v); changed = true; } }
        return changed ? merged : prev;
      });
    });

    return () => { mounted = false; };
  // pendingResources intentionally excluded — resourceGvKinds is the stable dep
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resourceGvKinds]);

  // Merge MRD schemas (from parent) with fetched native K8s schemas
  const combinedSchemaMap = useMemo(() => {
    if (!nativeSchemaMap.size) return mrdSchemaMap;
    const merged = new Map(mrdSchemaMap ?? []);
    for (const [k, v] of nativeSchemaMap) merged.set(k, v);
    return merged;
  }, [mrdSchemaMap, nativeSchemaMap]);

  // Memoize flattened schema fields so flattenJsonSchema isn't called on every render/mouse event.
  const xrdAllFields  = useMemo(() => flattenJsonSchema(effectiveXrdSchema), [effectiveXrdSchema]);
  const xrdLeafFields = useMemo(
    () => xrdAllFields.filter(s => s.path.startsWith('spec.') && s.type !== 'object' && s.type !== 'array'),
    [xrdAllFields]
  );
  const mrdFieldsCache = useMemo(() => {
    const cache = new Map<string, FieldSuggestion[]>();
    if (!combinedSchemaMap) return cache;
    for (const [key, schema] of combinedSchemaMap) cache.set(key, flattenJsonSchema(schema, '', 12));
    return cache;
  }, [combinedSchemaMap]);

  const mrdMapPathsCache = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    if (!combinedSchemaMap) return cache;
    for (const [key, schema] of combinedSchemaMap) cache.set(key, findMapPaths(schema));
    return cache;
  }, [combinedSchemaMap]);

  const mrdArrayPathsCache = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    if (!combinedSchemaMap) return cache;
    for (const [key, schema] of combinedSchemaMap) cache.set(key, findArrayPaths(schema));
    return cache;
  }, [combinedSchemaMap]);

  const mrdPreserveUnknownPathsCache = useMemo(() => {
    const cache = new Map<string, Set<string>>();
    if (!combinedSchemaMap) return cache;
    for (const [key, schema] of combinedSchemaMap) cache.set(key, findPreserveUnknownPaths(schema));
    return cache;
  }, [combinedSchemaMap]);

  return {
    effectiveXrdSchema,
    xrdSchemaDone,
    schemaKind,
    schemaApiVersion,
    schemaAttemptedKeys,
    combinedSchemaMap,
    xrdAllFields,
    xrdLeafFields,
    mrdFieldsCache,
    mrdMapPathsCache,
    mrdArrayPathsCache,
    mrdPreserveUnknownPathsCache,
  };
}
