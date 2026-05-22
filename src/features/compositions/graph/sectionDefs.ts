import { nodeIdToRef } from './constants';
import { setDeepPath } from './pathUtils';

// ── Section definitions ────────────────────────────────────────────────────────

export type SectionName = 'template' | 'forEach' | 'includeWhen' | 'readyWhen';

export interface SectionDef {
  name: SectionName;
  /** fieldPath prefix used to identify this section (e.g. '_forEach.', ''). */
  prefix: string;
  defaultCanImport: boolean;
  defaultCanExport: boolean;
  /** Returns the fixed CEL type for this section, or undefined if caller must look it up in schema. */
  fieldType(relPath: string): string | undefined;
  /** Write celExpr into the correct location on tgtRes using the section-relative path. */
  applyEdge(tgtRes: any, relPath: string, celExpr: string): void;
  /** Build the CEL operand string for a source reference (only called for export-capable sections). */
  celRef(srcNodeId: string, relPath: string): string;
}


export const SECTION_DEFS: Record<SectionName, SectionDef> = {
  template: {
    name: 'template',
    prefix: '',
    defaultCanImport: true,
    defaultCanExport: true,
    fieldType: () => undefined,
    applyEdge(tgtRes, relPath, celExpr) {
      if (!tgtRes.template) tgtRes.template = {};
      setDeepPath(tgtRes.template, relPath, celExpr);
    },
    celRef(srcNodeId, relPath) {
      const ref = nodeIdToRef(srcNodeId);
      return relPath ? `${ref}.${relPath}` : ref;
    },
  },
  forEach: {
    name: 'forEach',
    prefix: '_forEach.',
    defaultCanImport: true,
    defaultCanExport: true,
    fieldType: () => 'any',
    applyEdge(tgtRes, relPath, celExpr) {
      if (!tgtRes.forEach) tgtRes.forEach = [];
      const entry = tgtRes.forEach.find((e: any) => relPath in e);
      if (entry) { entry[relPath] = celExpr; }
      else { tgtRes.forEach.push({ [relPath]: celExpr }); }
    },
    celRef(_srcNodeId, relPath) {
      // forEach iteration variable — emit bare var name, no node prefix.
      return relPath;
    },
  },
  includeWhen: {
    name: 'includeWhen',
    prefix: '_includeWhen.',
    defaultCanImport: true,
    defaultCanExport: false,
    fieldType: () => 'any',  // CEL expressions — any source type is valid input
    applyEdge(tgtRes, relPath, celExpr) {
      if (!Array.isArray(tgtRes.includeWhen)) {
        tgtRes.includeWhen = tgtRes.includeWhen ? [tgtRes.includeWhen] : [];
      }
      const idx = relPath === 'value' ? 0 : (parseInt(relPath, 10) || 0);
      tgtRes.includeWhen[idx] = celExpr;
    },
    celRef() { return ''; },
  },
  readyWhen: {
    name: 'readyWhen',
    prefix: '_readyWhen.',
    defaultCanImport: true,
    defaultCanExport: false,
    fieldType: () => 'any',  // CEL expressions — any source type is valid input
    applyEdge(tgtRes, relPath, celExpr) {
      if (!Array.isArray(tgtRes.readyWhen)) {
        tgtRes.readyWhen = tgtRes.readyWhen ? [tgtRes.readyWhen] : [];
      }
      const idx = relPath === 'value' ? 0 : (parseInt(relPath, 10) || 0);
      tgtRes.readyWhen[idx] = celExpr;
    },
    celRef() { return ''; },
  },
};

// ── Path helpers ───────────────────────────────────────────────────────────────

/** Returns which section owns a given fieldPath string. */
export function sectionOf(fp: string): SectionName {
  if (fp.startsWith('_forEach.')) return 'forEach';
  if (fp.startsWith('_includeWhen.')) return 'includeWhen';
  if (fp.startsWith('_readyWhen.')) return 'readyWhen';
  return 'template';
}

/** Strips the section prefix from a fieldPath, returning the section-relative path. */
export function sectionRelPath(fp: string): string {
  const def = SECTION_DEFS[sectionOf(fp)];
  return def.prefix ? fp.slice(def.prefix.length) : fp;
}

/** Builds a fully-qualified fieldPath from a section name and a relative path. */
export function qualifiedPath(s: SectionName, relPath: string): string {
  return SECTION_DEFS[s].prefix + relPath;
}
