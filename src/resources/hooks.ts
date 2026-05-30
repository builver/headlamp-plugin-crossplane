import { useMemo } from 'react';
import { getServedSchema } from './helpers';

interface JsonHolder {
  jsonData?: any;
}

/**
 * Builds a Map of "group/kind" -> openAPIV3Schema from MRD objects.
 * Reusable across Composition detail and XR detail pages.
 */
export function useMrdSchemaMap(mrds: JsonHolder[] | null): Map<string, any> {
  return useMemo(() => {
    const map = new Map<string, any>();
    for (const mrd of mrds ?? []) {
      const group: string = mrd.jsonData?.spec?.group ?? '';
      const kind: string = mrd.jsonData?.spec?.names?.kind ?? '';
      if (!group || !kind) continue;
      const schema = getServedSchema(mrd.jsonData);
      if (schema) map.set(`${group}/${kind}`, schema);
    }
    return map;
  }, [mrds]);
}
