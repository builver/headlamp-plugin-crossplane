import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { SectionBox } from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ResourceRef } from '../../components/map/types';
import type { PipelineStep } from '../../resources';
import {
  Composition,
  getCompositionRef,
  getServedSchema,
  isKroStep,
  ManagedResourceDefinition,
  useMrdSchemaMap,
  XRScope,
} from '../../resources';
import { KroStepGraph } from '../compositions/CompositionNodeEditor';
import { SCHEMA_NODE_ID } from '../compositions/graph/constants';

interface XRKroGraphProps {
  item: KubeObject;
  xrd: KubeObject;
  scope: XRScope;
}

// Cache of dynamic KubeObject subclasses keyed by `${apiVersion}/${kind}`.
// Headlamp's useGet caching depends on class identity, so we stabilize it at
// module scope to avoid invalidating the cache every render.
const classCache = new Map<string, typeof KubeObject>();

/** Resolve the KubeObject class for an arbitrary apiVersion/kind. Returns null
 *  if neither a native class nor a CRD-backed match is available yet. */
function getResourceClass(
  apiVersion: string, kind: string, crds: KubeObject[],
): typeof KubeObject | null {
  // Built-in K8s resources (Deployment, ConfigMap, …) have ready-made classes.
  const native = Object.values(K8s.ResourceClasses).find(
    (c: any) => c.kind === kind && c.apiVersion === apiVersion,
  ) as typeof KubeObject | undefined;
  if (native) return native;

  const cacheKey = `${apiVersion}/${kind}`;
  const cached = classCache.get(cacheKey);
  if (cached) return cached;

  const slashIdx = apiVersion.indexOf('/');
  const group = slashIdx >= 0 ? apiVersion.slice(0, slashIdx) : '';
  const crd = crds.find(c =>
    c.jsonData?.spec?.group === group &&
    c.jsonData?.spec?.names?.kind === kind,
  );
  if (!crd) return null;
  const plural: string | undefined = crd.jsonData?.spec?.names?.plural;
  const scope: string | undefined = crd.jsonData?.spec?.scope;
  if (!plural) return null;

  class DynamicResource extends KubeObject {
    static kind = kind;
    static apiName = plural;
    static apiVersion = apiVersion;
    static isNamespaced = scope === 'Namespaced';
  }
  classCache.set(cacheKey, DynamicResource);
  return DynamicResource;
}

/** Internal helper that runs one `Class.useGet(name, namespace)` per composed
 *  resource and reports the JSON back to the parent. Encapsulating the hook
 *  in a child component keeps the Rules of Hooks satisfied while the number
 *  of refs varies. */
function RefFetcher({ ResourceClass, name, namespace, fetchKey, onChange }: {
  ResourceClass: typeof KubeObject;
  name: string;
  namespace: string | undefined;
  fetchKey: string;
  onChange: (fetchKey: string, resource: any | null) => void;
}) {
  // useGet is a static hook on KubeObject subclasses; cast to bypass the
  // generic typing limitation.
  const [obj, err] = (ResourceClass as any).useGet(name, namespace) as [KubeObject | null, any];
  const json = obj?.jsonData ?? null;
  useEffect(() => {
    onChange(fetchKey, json);
  }, [json, fetchKey, onChange]);
  useEffect(() => {
    if (err) {
      // eslint-disable-next-line no-console
      console.warn(`XRKroGraph: failed to fetch ${fetchKey}`, err);
    }
  }, [err, fetchKey]);
  return null;
}

export function XRKroGraph({ item, xrd, scope }: XRKroGraphProps) {
  const compositionName = getCompositionRef(item, scope);
  const [comp] = Composition.useGet(compositionName !== '-' ? compositionName : '');
  const [mrds] = ManagedResourceDefinition.useList();
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList() as [KubeObject[] | null, any];

  const mrdSchemaMap = useMrdSchemaMap(mrds);
  const xrdSchema = useMemo(() => getServedSchema(xrd.jsonData), [xrd]);

  const pipeline: PipelineStep[] = comp?.jsonData?.spec?.pipeline ?? [];
  // Headlamp's polling reissues `comp` (and thus pipeline) every cycle even when
  // content is unchanged, so key the memo on the composition's resourceVersion
  // to avoid cascading recomputes through composedValues → overlay every poll.
  const kroSteps = useMemo(
    () => pipeline.filter(isKroStep),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [comp?.metadata?.resourceVersion]
  );

  const refs: ResourceRef[] = useMemo(() =>
    scope === 'LegacyCluster'
      ? (item.jsonData?.spec?.resourceRefs ?? [])
      : (item.jsonData?.spec?.crossplane?.resourceRefs ?? []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item?.metadata?.resourceVersion, scope]
  );

  // Each entry drives one RefFetcher child. Refs whose CRD is unknown (or whose
  // namespace can't be resolved) are simply skipped — they'll re-evaluate as
  // CRDs load.
  const refFetchers = useMemo(() => {
    if (!crds) return [];
    const xrNamespace = item?.metadata?.namespace;
    return refs.flatMap(ref => {
      const ResourceClass = getResourceClass(ref.apiVersion, ref.kind, crds);
      if (!ResourceClass) return [];
      const isNamespaced = (ResourceClass as any).isNamespaced as boolean;
      let namespace: string | undefined;
      if (isNamespaced) {
        // Namespaced MRs without an explicit ref.namespace fall back to the XR's
        // namespace for namespaced XRs. Cluster-scoped XRs have no good fallback
        // and the ref will be dropped (with a warning) until Crossplane records
        // the namespace.
        namespace = ref.namespace ?? (scope === 'Namespaced' ? xrNamespace : undefined);
        if (!namespace) {
          // eslint-disable-next-line no-console
          console.warn(`XRKroGraph: namespaced ref ${ref.apiVersion}/${ref.kind}/${ref.name} has no namespace; skipping`);
          return [];
        }
      }
      const fetchKey = `${ref.apiVersion}/${ref.kind}/${namespace ?? ''}/${ref.name}`;
      return [{ ResourceClass, name: ref.name, namespace, fetchKey }];
    });
  }, [refs, crds, scope, item?.metadata?.namespace]);

  const [fetched, setFetched] = useState<Map<string, any>>(new Map());
  const setOne = useCallback((fetchKey: string, resource: any | null) => {
    setFetched(prev => {
      const cur = prev.get(fetchKey);
      if (cur === resource) return prev;
      const next = new Map(prev);
      if (resource === null) next.delete(fetchKey);
      else next.set(fetchKey, resource);
      return next;
    });
  }, []);

  // Drop entries from fetched whose ref is no longer present (handles refs
  // shrinking or namespace flips). RefFetcher children also stop reporting on
  // unmount, but pruning here keeps the map tight.
  useEffect(() => {
    const liveKeys = new Set(refFetchers.map(f => f.fetchKey));
    setFetched(prev => {
      let changed = false;
      const next = new Map(prev);
      for (const k of next.keys()) {
        if (!liveKeys.has(k)) { next.delete(k); changed = true; }
      }
      return changed ? next : prev;
    });
  }, [refFetchers]);

  // Build composedValues map: kro resource ID -> fetched resource JSON(s).
  // Crossplane stamps each composed resource with the
  // crossplane.io/composition-resource-name annotation, which function-kro sets
  // to the kro resource id ("<id>-<instance>" for forEach collections). Match on
  // that instead of kind/apiVersion, which is ambiguous when several nodes share
  // a kind (e.g. multiple provider-kubernetes Object resources).
  const composedValues = useMemo(() => {
    const map = new Map<string, any[]>();

    // The schema node mirrors the XR itself, so overlay the XR's own values.
    if (item.jsonData) map.set(SCHEMA_NODE_ID, [item.jsonData]);

    const fetchedResources = [...fetched.values()];
    if (fetchedResources.length === 0) return map;

    const ids: string[] = [];
    for (const step of kroSteps) {
      for (const res of ((step.input as any)?.resources ?? [])) {
        if (res?.id) ids.push(res.id);
      }
    }
    const add = (id: string, cr: any) => {
      const list = map.get(id);
      if (list) list.push(cr);
      else map.set(id, [cr]);
    };

    for (const cr of fetchedResources) {
      const name = cr?.metadata?.annotations?.['crossplane.io/composition-resource-name'];
      if (typeof name !== 'string' || !name) continue;
      if (ids.includes(name)) {
        add(name, cr); // single resource: annotation === id
      } else {
        const owner = ids.find(id => name.startsWith(`${id}-`));
        if (owner) add(owner, cr); // forEach collection instance
      }
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.metadata?.resourceVersion, kroSteps, fetched]);

  if (compositionName === '-' || !comp || kroSteps.length === 0) return null;

  return (
    <>
      {refFetchers.map(f => (
        <RefFetcher key={f.fetchKey} ResourceClass={f.ResourceClass}
          name={f.name} namespace={f.namespace} fetchKey={f.fetchKey} onChange={setOne} />
      ))}
      <SectionBox title="Composition Graph">
        {kroSteps.map(s => (
          <KroStepGraph
            key={s.step}
            input={s.input!}
            compositionName={compositionName}
            stepIndex={pipeline.indexOf(s)}
            xrdSchema={xrdSchema}
            mrdSchemaMap={mrdSchemaMap}
            xrdScope={scope}
            requirements={s.requirements}
            readOnly
            composedValues={composedValues}
          />
        ))}
      </SectionBox>
    </>
  );
}
