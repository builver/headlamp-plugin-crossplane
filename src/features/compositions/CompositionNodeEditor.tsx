import { Icon } from '@iconify/react';
import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { DataField } from '@kinvolk/headlamp-plugin/lib/components/common';
import { Box, IconButton, Tooltip } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { GraphCanvas } from './graph/GraphCanvas';
import { KindOption } from './graph/types';

// ── KroStepGraph ──────────────────────────────────────────────────────────────

interface KroStepGraphProps {
  input: any;
  inputYaml?: string;
  compositionName: string;
  stepIndex: number;
  /** openAPIV3Schema from the matching XRD for field path autocomplete. */
  xrdSchema?: any;
  /** Maps "group/kind" → openAPIV3Schema for MRD-backed resource nodes. */
  mrdSchemaMap?: Map<string, any>;
  /** 'Namespaced' | 'Cluster' | 'LegacyCluster' — limits kind options to matching CRD scope. */
  xrdScope?: string;
}

export function KroStepGraph({ input, inputYaml, compositionName, stepIndex, xrdSchema, mrdSchemaMap, xrdScope }: KroStepGraphProps) {
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList() as [any[] | null, any];

  const kindOptions = useMemo((): KindOption[] => {
    const seen = new Set<string>();
    const result: KindOption[] = [];

    const push = (kind: string, apiVersion: string, namespaced: boolean) => {
      if (!kind || !apiVersion) return;
      if (xrdScope === 'Namespaced' && !namespaced) return;
      const key = `${apiVersion}/${kind}`;
      if (seen.has(key)) return;
      seen.add(key);
      result.push({ kind, apiVersion });
    };

    // Native K8s resources (Deployment, Pod, Service, …)
    for (const cls of Object.values(K8s.ResourceClasses) as any[]) {
      push(cls.kind, cls.apiVersion, cls.isNamespaced ?? true);
    }

    // Custom resources from installed CRDs
    for (const crd of crds ?? []) {
      const namespaced = (crd.jsonData?.spec?.scope ?? 'Cluster') === 'Namespaced';
      const group: string = crd.jsonData?.spec?.group ?? '';
      const versions: any[] = crd.jsonData?.spec?.versions ?? [];
      const version: string = (versions.find((v: any) => v.served !== false) ?? versions[0])?.name ?? '';
      const kind: string = crd.jsonData?.spec?.names?.kind ?? '';
      push(kind, group ? `${group}/${version}` : version, namespaced);
    }

    return result.sort((a, b) => a.kind.localeCompare(b.kind));
  }, [crds, xrdScope]);

  const [mode, setMode] = useState<'graph' | 'yaml'>('graph');
  const [isDirty, setIsDirty] = useState(false);

  // Block browser close / refresh when dirty.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  const btnSx = (active: boolean) => ({
    border: '1px solid', borderColor: 'divider', borderRadius: 1,
    bgcolor: active ? 'action.selected' : 'background.paper',
    '&:hover': { bgcolor: active ? 'action.selected' : 'action.hover' },
    boxShadow: 1,
  });

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.75, gap: 0.5 }}>
        <Tooltip title="Graph view">
          <IconButton size="small" onClick={() => setMode('graph')} sx={btnSx(mode === 'graph')}>
            <Icon icon="mdi:graph-outline" width={16} height={16} />
          </IconButton>
        </Tooltip>
        <Tooltip title="YAML view">
          <IconButton size="small" onClick={() => setMode('yaml')} sx={btnSx(mode === 'yaml')}>
            <Icon icon="mdi:code-braces" width={16} height={16} />
          </IconButton>
        </Tooltip>
      </Box>
      {mode === 'graph'
        ? <GraphCanvas input={input} height={480}
            compositionName={compositionName} stepIndex={stepIndex}
            onDirtyChange={setIsDirty} xrdSchema={xrdSchema} mrdSchemaMap={mrdSchemaMap}
            kindOptions={kindOptions} />
        : inputYaml ? <DataField label="input.yaml" disableLabel value={inputYaml} onChange={() => {}} /> : null
      }
    </Box>
  );
}
