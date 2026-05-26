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
import {
  ResourceHelperPanel,
} from '../../components/ResourceHelperDialog';
import { CompositeResourceDefinition, CrossplaneFunction } from '../../resources';

const NAME_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

interface PipelineStepEntry {
  step: string;
  functionRef: string;
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
    setSteps(pipeline.map((s: any) => ({ step: s.step, functionRef: s.functionRef?.name ?? '' })));
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
    setSteps(prev => [...prev, { step: stepName, functionRef: fnName }]);
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

    const pipeline = steps.map(s => ({
      step: s.step,
      functionRef: { name: s.functionRef },
    }));

    if (existing) {
      return {
        ...structuredClone(existing.jsonData),
        spec: {
          ...existing.jsonData.spec,
          ...(compositeTypeRef ? { compositeTypeRef } : {}),
          mode: 'Pipeline',
          pipeline,
        },
      };
    }
    return {
      apiVersion: 'apiextensions.crossplane.io/v1',
      kind: 'Composition',
      metadata: { name: name.trim() || '<name>' },
      spec: {
        ...(compositeTypeRef ? { compositeTypeRef } : {}),
        mode: 'Pipeline',
        pipeline,
      },
    };
  }, [existing, name, selectedXRD, steps]);

  const nameError = name.length > 0 && !NAME_REGEX.test(name);
  const canSubmit = name.length > 0 && !nameError && !!selectedXRD && steps.length > 0;

  return {
    name, setName, nameError, canSubmit, buildItem, resetForm,
    selectedXRD, setSelectedXRD, xrdOptions,
    steps, addStep, removeStep, moveStep,
    newStepName, setNewStepName, newStepFunction, setNewStepFunction,
    functionNames,
  };
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
    steps, addStep, removeStep, moveStep,
    newStepName, setNewStepName, newStepFunction, setNewStepFunction,
    functionNames,
  } = form;

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
              <Box key={s.step} display="flex" alignItems="center" gap={0.5}>
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
