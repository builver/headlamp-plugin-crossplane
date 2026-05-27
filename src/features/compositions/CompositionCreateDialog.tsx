import { Icon } from '@iconify/react';
import {
  Autocomplete,
  Box,
  Chip,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import {
  ResourceHelperPanel,
} from '../../components/ResourceHelperDialog';
import { CompositeResourceDefinition, CrossplaneFunction } from '../../resources';

const NAME_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

interface RequiredResourceEntry {
  requirementName: string;
  apiVersion: string;
  kind: string;
  name: string;
  namespace: string;
  matchLabels: string;
}

interface RequiredSchemaEntry {
  requirementName: string;
  apiVersion: string;
  kind: string;
}

interface PipelineStepEntry {
  step: string;
  functionRef: string;
  inputYaml: string;
  requiredResources: RequiredResourceEntry[];
  requiredSchemas: RequiredSchemaEntry[];
}

function useCompositionForm(existing: any | undefined, isOpen: boolean) {
  const [xrds] = CompositeResourceDefinition.useList();
  const [functions] = CrossplaneFunction.useList();
  const [name, setName] = useState('');
  const [selectedXRD, setSelectedXRD] = useState<any | null>(null);
  const [steps, setSteps] = useState<PipelineStepEntry[]>([]);
  const [newStepName, setNewStepName] = useState('');
  const [newStepFunction, setNewStepFunction] = useState('');

  const seededRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || !existing || !xrds) return;
    seededRef.current = true;
    setName(existing.metadata?.name ?? '');
    const ref = existing.jsonData?.spec?.compositeTypeRef;
    if (ref && xrds) {
      const group = (ref.apiVersion as string)?.split('/')[0] ?? '';
      const match = xrds.find(
        (x: any) => x.jsonData?.spec?.names?.kind === ref.kind && x.jsonData?.spec?.group === group
      );
      setSelectedXRD(match ?? null);
    }
    const pipeline: any[] = existing.jsonData?.spec?.pipeline ?? [];
    setSteps(pipeline.map((s: any) => ({
      step: s.step,
      functionRef: s.functionRef?.name ?? '',
      inputYaml: s.input ? yamlStringify(s.input, { blockQuote: true }) : '',
      requiredResources: (s.requirements?.requiredResources ?? []).map((r: any) => ({
        requirementName: r.requirementName ?? '',
        apiVersion: r.apiVersion ?? '',
        kind: r.kind ?? '',
        name: r.name ?? '',
        namespace: r.namespace ?? '',
        matchLabels: r.matchLabels
          ? Object.entries(r.matchLabels).map(([k, v]) => `${k}=${v}`).join(', ')
          : '',
      })),
      requiredSchemas: (s.requirements?.requiredSchemas ?? []).map((r: any) => ({
        requirementName: r.requirementName ?? '',
        apiVersion: r.apiVersion ?? '',
        kind: r.kind ?? '',
      })),
    })));
  }, [isOpen, existing, xrds]);

  const xrdOptions = useMemo(() => {
    if (!xrds) return [];
    return xrds.map((x: any) => ({
      xrd: x,
      label: `${x.jsonData?.spec?.names?.kind} (${x.jsonData?.spec?.group})`,
    }));
  }, [xrds]);

  const functionNames = useMemo(
    () => (functions ?? []).map((f: any) => f.metadata.name as string),
    [functions]
  );

  const addStep = useCallback(() => {
    const stepName = newStepName.trim();
    const fnName = newStepFunction.trim();
    if (!stepName || !fnName) return;
    if (steps.some(s => s.step === stepName)) return;
    setSteps(prev => [...prev, {
      step: stepName, functionRef: fnName, inputYaml: '',
      requiredResources: [], requiredSchemas: [],
    }]);
    setNewStepName('');
    setNewStepFunction('');
  }, [newStepName, newStepFunction, steps]);

  const removeStep = useCallback((stepName: string) => {
    setSteps(prev => prev.filter(s => s.step !== stepName));
  }, []);

  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    setSteps(prev => {
      const next = [...prev];
      const target = index + direction;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const updateStep = useCallback((stepName: string, update: Partial<PipelineStepEntry>) => {
    setSteps(prev => prev.map(s => s.step === stepName ? { ...s, ...update } : s));
  }, []);

  const resetForm = useCallback(() => {
    setName('');
    setSelectedXRD(null);
    setSteps([]);
    setNewStepName('');
    setNewStepFunction('');
  }, []);

  const buildItem = useCallback(() => {
    const xrd = selectedXRD;
    const compositeTypeRef = xrd
      ? {
          apiVersion: `${xrd.jsonData?.spec?.group}/${xrd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1'}`,
          kind: xrd.jsonData?.spec?.names?.kind,
        }
      : undefined;

    const pipeline = steps.map(s => {
      const entry: Record<string, unknown> = {
        step: s.step,
        functionRef: { name: s.functionRef },
      };
      if (s.inputYaml.trim()) {
        try {
          entry.input = yamlParse(s.inputYaml);
        } catch {
          // invalid YAML — skip input
        }
      }
      const reqRes = s.requiredResources
        .filter(r => r.requirementName.trim() && r.apiVersion.trim() && r.kind.trim())
        .map(r => {
          const out: Record<string, unknown> = {
            requirementName: r.requirementName.trim(),
            apiVersion: r.apiVersion.trim(),
            kind: r.kind.trim(),
          };
          if (r.name.trim()) out.name = r.name.trim();
          if (r.namespace.trim()) out.namespace = r.namespace.trim();
          if (r.matchLabels.trim()) {
            const labels: Record<string, string> = {};
            for (const pair of r.matchLabels.split(',')) {
              const idx = pair.indexOf('=');
              if (idx > 0) labels[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
            }
            out.matchLabels = labels;
          }
          return out;
        });
      const reqSchemas = s.requiredSchemas
        .filter(r => r.requirementName.trim() && r.apiVersion.trim() && r.kind.trim())
        .map(r => ({
          requirementName: r.requirementName.trim(),
          apiVersion: r.apiVersion.trim(),
          kind: r.kind.trim(),
        }));
      if (reqRes.length > 0 || reqSchemas.length > 0) {
        entry.requirements = {
          ...(reqRes.length > 0 ? { requiredResources: reqRes } : {}),
          ...(reqSchemas.length > 0 ? { requiredSchemas: reqSchemas } : {}),
        };
      }
      return entry;
    });

    const spec: Record<string, unknown> = {
      ...(compositeTypeRef ? { compositeTypeRef } : {}),
      mode: 'Pipeline',
      pipeline,
    };

    if (existing) {
      return {
        ...structuredClone(existing.jsonData),
        spec: { ...existing.jsonData.spec, ...spec },
      };
    }
    return {
      apiVersion: 'apiextensions.crossplane.io/v1',
      kind: 'Composition',
      metadata: { name: name.trim() || '<name>' },
      spec,
    };
  }, [existing, name, selectedXRD, steps]);

  const nameError = name.length > 0 && !NAME_REGEX.test(name);
  const canSubmit = name.length > 0 && !nameError && !!selectedXRD && steps.length > 0;

  return {
    name, setName, nameError, canSubmit, buildItem, resetForm,
    selectedXRD, setSelectedXRD, xrdOptions,
    steps, addStep, removeStep, moveStep, updateStep,
    newStepName, setNewStepName, newStepFunction, setNewStepFunction,
    functionNames,
  };
}

function RequiredResourcesEditor({
  entries,
  onChange,
}: {
  entries: RequiredResourceEntry[];
  onChange: (entries: RequiredResourceEntry[]) => void;
}) {
  const add = useCallback(() => {
    onChange([...entries, { requirementName: '', apiVersion: '', kind: '', name: '', namespace: '', matchLabels: '' }]);
  }, [entries, onChange]);

  const remove = useCallback((index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  }, [entries, onChange]);

  const update = useCallback((index: number, field: keyof RequiredResourceEntry, value: string) => {
    onChange(entries.map((e, i) => i === index ? { ...e, [field]: value } : e));
  }, [entries, onChange]);

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">Required Resources (bootstrap)</Typography>
        <IconButton size="small" onClick={add} title="Add required resource">
          <Icon icon="mdi:plus" width="0.875rem" />
        </IconButton>
      </Box>
      {entries.map((r, i) => (
        <Box key={i} display="flex" flexDirection="column" gap={0.5} mb={1} ml={1} pl={1} borderLeft={2} borderColor="divider">
          <Box display="flex" gap={0.5} alignItems="flex-start">
            <TextField
              label="Requirement Name"
              value={r.requirementName}
              onChange={e => update(i, 'requirementName', e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              required
            />
            <IconButton size="small" onClick={() => remove(i)} sx={{ mt: 0.5 }}>
              <Icon icon="mdi:close-circle-outline" width="1rem" />
            </IconButton>
          </Box>
          <Box display="flex" gap={0.5}>
            <TextField
              label="API Version"
              value={r.apiVersion}
              onChange={e => update(i, 'apiVersion', e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              placeholder="v1"
              required
            />
            <TextField
              label="Kind"
              value={r.kind}
              onChange={e => update(i, 'kind', e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              placeholder="ConfigMap"
              required
            />
          </Box>
          <Box display="flex" gap={0.5}>
            <TextField
              label="Name"
              value={r.name}
              onChange={e => update(i, 'name', e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              placeholder="Select by name (optional)"
            />
            <TextField
              label="Namespace"
              value={r.namespace}
              onChange={e => update(i, 'namespace', e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              placeholder="(optional)"
            />
          </Box>
          <TextField
            label="Match Labels"
            value={r.matchLabels}
            onChange={e => update(i, 'matchLabels', e.target.value)}
            size="small"
            fullWidth
            placeholder="app=my-app, env=prod (optional, comma-separated)"
          />
        </Box>
      ))}
    </Box>
  );
}

function RequiredSchemasEditor({
  entries,
  onChange,
}: {
  entries: RequiredSchemaEntry[];
  onChange: (entries: RequiredSchemaEntry[]) => void;
}) {
  const add = useCallback(() => {
    onChange([...entries, { requirementName: '', apiVersion: '', kind: '' }]);
  }, [entries, onChange]);

  const remove = useCallback((index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  }, [entries, onChange]);

  const update = useCallback((index: number, field: keyof RequiredSchemaEntry, value: string) => {
    onChange(entries.map((e, i) => i === index ? { ...e, [field]: value } : e));
  }, [entries, onChange]);

  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between">
        <Typography variant="caption" color="text.secondary">Required Schemas (v2.2+)</Typography>
        <IconButton size="small" onClick={add} title="Add required schema">
          <Icon icon="mdi:plus" width="0.875rem" />
        </IconButton>
      </Box>
      {entries.map((r, i) => (
        <Box key={i} display="flex" gap={0.5} alignItems="flex-start" mb={1} ml={1} pl={1} borderLeft={2} borderColor="divider">
          <TextField
            label="Requirement Name"
            value={r.requirementName}
            onChange={e => update(i, 'requirementName', e.target.value)}
            size="small"
            sx={{ flex: 1 }}
            required
          />
          <TextField
            label="API Version"
            value={r.apiVersion}
            onChange={e => update(i, 'apiVersion', e.target.value)}
            size="small"
            sx={{ flex: 1 }}
            placeholder="example.org/v1alpha1"
            required
          />
          <TextField
            label="Kind"
            value={r.kind}
            onChange={e => update(i, 'kind', e.target.value)}
            size="small"
            sx={{ flex: 1 }}
            placeholder="XMyResource"
            required
          />
          <IconButton size="small" onClick={() => remove(i)} sx={{ mt: 0.5 }}>
            <Icon icon="mdi:close-circle-outline" width="1rem" />
          </IconButton>
        </Box>
      ))}
    </Box>
  );
}

function CompositionFormFields({
  existing,
  form,
}: {
  existing: any;
  form: ReturnType<typeof useCompositionForm>;
}) {
  const {
    name, setName, nameError,
    selectedXRD, setSelectedXRD, xrdOptions,
    steps, addStep, removeStep, moveStep, updateStep,
    newStepName, setNewStepName, newStepFunction, setNewStepFunction,
    functionNames,
  } = form;

  const [expandedStep, setExpandedStep] = useState<string | null>(null);

  return (
    <>
      <TextField
        label="Name"
        value={name}
        onChange={e => setName(e.target.value)}
        error={nameError}
        helperText={nameError ? 'Must be a valid Kubernetes name' : ''}
        fullWidth
        size="small"
        required
        disabled={!!existing}
      />

      <Autocomplete
        options={xrdOptions}
        getOptionLabel={opt => opt.label}
        value={xrdOptions.find(o => o.xrd === selectedXRD) ?? null}
        onChange={(_, opt) => setSelectedXRD(opt?.xrd ?? null)}
        renderInput={params => (
          <TextField {...params} label="Composite Type (XRD)" size="small" required />
        )}
        isOptionEqualToValue={(opt, val) => opt.xrd === val.xrd}
      />

      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Pipeline Steps
        </Typography>
        {steps.length > 0 && (
          <Box display="flex" flexDirection="column" gap={0.5} mb={1}>
            {steps.map((s, i) => (
              <Box key={s.step}>
                <Box display="flex" alignItems="center" gap={0.5}>
                  <Chip
                    label={
                      <Box display="flex" alignItems="center" gap={0.5} component="span">
                        <strong>{s.step}</strong>
                        <Icon icon="mdi:arrow-right" width="0.875rem" />
                        <span>{s.functionRef}</span>
                      </Box>
                    }
                    size="small"
                    onDelete={() => removeStep(s.step)}
                  />
                  <IconButton size="small" onClick={() => moveStep(i, -1)} disabled={i === 0}>
                    <Icon icon="mdi:arrow-up" width="1rem" />
                  </IconButton>
                  <IconButton size="small" onClick={() => moveStep(i, 1)} disabled={i === steps.length - 1}>
                    <Icon icon="mdi:arrow-down" width="1rem" />
                  </IconButton>
                  <IconButton
                    size="small"
                    onClick={() => setExpandedStep(expandedStep === s.step ? null : s.step)}
                    title="Edit step details"
                  >
                    <Icon
                      icon={expandedStep === s.step ? 'mdi:chevron-up' : 'mdi:chevron-down'}
                      width="1rem"
                    />
                  </IconButton>
                </Box>
                {expandedStep === s.step && (
                  <Box mt={0.5} ml={1} display="flex" flexDirection="column" gap={1.5}>
                    <TextField
                      label="Input (YAML)"
                      value={s.inputYaml}
                      onChange={e => updateStep(s.step, { inputYaml: e.target.value })}
                      multiline
                      minRows={3}
                      maxRows={12}
                      fullWidth
                      size="small"
                      placeholder={`apiVersion: pt.fn.crossplane.io/v1beta1\nkind: Resources\nresources: []`}
                      InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.8rem' } }}
                      helperText="Function-specific input object (optional)"
                    />
                    <RequiredResourcesEditor
                      entries={s.requiredResources}
                      onChange={requiredResources => updateStep(s.step, { requiredResources })}
                    />
                    <RequiredSchemasEditor
                      entries={s.requiredSchemas}
                      onChange={requiredSchemas => updateStep(s.step, { requiredSchemas })}
                    />
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
        <Box display="flex" gap={1} alignItems="flex-start">
          <TextField
            label="Step name"
            value={newStepName}
            onChange={e => setNewStepName(e.target.value)}
            size="small"
            placeholder="render"
            sx={{ flex: 1 }}
          />
          <Autocomplete
            freeSolo
            options={functionNames}
            value={newStepFunction}
            onChange={(_, val) => setNewStepFunction(val ?? '')}
            onInputChange={(_, val) => setNewStepFunction(val)}
            renderInput={params => (
              <TextField {...params} label="Function" size="small" placeholder="function-name" />
            )}
            sx={{ flex: 2 }}
          />
          <IconButton
            onClick={addStep}
            disabled={!newStepName.trim() || !newStepFunction.trim()}
            size="small"
            sx={{ mt: 0.5 }}
          >
            <Icon icon="mdi:plus-circle" />
          </IconButton>
        </Box>
      </Box>
    </>
  );
}

interface PanelProps {
  existing?: any;
  onDone?: () => void;
  activityId?: string;
  cluster?: string;
}

export function CompositionCreatePanel({ existing, onDone, activityId, cluster }: PanelProps) {
  const form = useCompositionForm(existing, true);
  return (
    <ResourceHelperPanel
      resourceName="Composition"
      existing={existing}
      buildItem={form.buildItem}
      canSubmit={form.canSubmit}
      onReset={form.resetForm}
      onDone={onDone}
      activityId={activityId}
      cluster={cluster}
    >
      <CompositionFormFields existing={existing} form={form} />
    </ResourceHelperPanel>
  );
}
