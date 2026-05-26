import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material';
import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ResourceHelperDialog,
  ResourceHelperPanel,
} from '../../components/ResourceHelperDialog';
import { ManagedResourceDefinition } from '../../resources';

function matchesPattern(mrdName: string, pattern: string): boolean {
  if (pattern.startsWith('*')) return mrdName.endsWith(pattern.slice(1));
  return mrdName === pattern;
}

function derivePatterns(selectedMRDs: Set<string>, mrdsByGroup: Map<string, any[]>): string[] {
  const patterns: string[] = [];
  for (const [group, mrds] of mrdsByGroup) {
    const selected = mrds.filter(m => selectedMRDs.has(m.metadata.name));
    if (selected.length === 0) continue;
    if (selected.length === mrds.length) {
      patterns.push(`*.${group}`);
    } else {
      for (const mrd of selected) patterns.push(mrd.metadata.name);
    }
  }
  return patterns;
}

const NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

function useMRAPForm(existing: any | undefined, isOpen: boolean) {
  const [mrds] = ManagedResourceDefinition.useList();
  const [name, setName] = useState('');
  const [selectedMRDs, setSelectedMRDs] = useState<Set<string>>(new Set());

  const seededRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || !existing || !mrds) return;
    seededRef.current = true;
    setName(existing.metadata?.name ?? '');
    const existingPatterns: string[] = existing.jsonData?.spec?.activate ?? [];
    const matched = new Set<string>();
    for (const mrd of mrds) {
      if (existingPatterns.some(p => matchesPattern(mrd.metadata.name, p))) {
        matched.add(mrd.metadata.name);
      }
    }
    setSelectedMRDs(matched);
  }, [isOpen, existing, mrds]);

  const mrdsByGroup = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const mrd of mrds ?? []) {
      const group: string = mrd.jsonData?.spec?.group ?? 'unknown';
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(mrd);
    }
    return new Map([...map.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }, [mrds]);

  const patterns = useMemo(
    () => derivePatterns(selectedMRDs, mrdsByGroup),
    [selectedMRDs, mrdsByGroup]
  );

  const previewMatches = useMemo(() => {
    if (patterns.length === 0) return [];
    return (mrds ?? []).filter(mrd => patterns.some(p => matchesPattern(mrd.metadata.name, p)));
  }, [patterns, mrds]);

  const toggleMRD = useCallback((mrdName: string) => {
    setSelectedMRDs(prev => {
      const next = new Set(prev);
      if (next.has(mrdName)) next.delete(mrdName);
      else next.add(mrdName);
      return next;
    });
  }, []);

  const toggleGroup = useCallback(
    (group: string, e: MouseEvent) => {
      e.stopPropagation();
      const groupMRDs = mrdsByGroup.get(group) ?? [];
      const allSelected = groupMRDs.every(m => selectedMRDs.has(m.metadata.name));
      setSelectedMRDs(prev => {
        const next = new Set(prev);
        for (const mrd of groupMRDs) {
          if (allSelected) next.delete(mrd.metadata.name);
          else next.add(mrd.metadata.name);
        }
        return next;
      });
    },
    [mrdsByGroup, selectedMRDs]
  );

  const resetForm = useCallback(() => {
    setName('');
    setSelectedMRDs(new Set());
  }, []);

  const buildItem = useCallback(
    () =>
      existing
        ? {
            ...structuredClone(existing.jsonData),
            spec: { ...existing.jsonData.spec, activate: patterns },
          }
        : {
            apiVersion: 'apiextensions.crossplane.io/v1alpha1',
            kind: 'ManagedResourceActivationPolicy',
            metadata: { name: name.trim() || '<name>' },
            spec: { activate: patterns },
          },
    [existing, name, patterns]
  );

  const nameError = name.length > 0 && !NAME_REGEX.test(name);
  const canSubmit = name.length > 0 && !nameError && patterns.length > 0;

  return {
    name, setName, nameError, canSubmit, buildItem, resetForm,
    mrdsByGroup, patterns, previewMatches, selectedMRDs, toggleMRD, toggleGroup,
  };
}

function MRAPFormFields({
  existing,
  form,
}: {
  existing: any;
  form: ReturnType<typeof useMRAPForm>;
}) {
  const {
    name, setName, nameError,
    mrdsByGroup, patterns, previewMatches, selectedMRDs, toggleMRD, toggleGroup,
  } = form;

  return (
    <>
      <TextField
        label="Name"
        value={name}
        onChange={e => setName(e.target.value)}
        error={nameError}
        helperText={
          nameError
            ? 'Must be a valid Kubernetes name (lowercase alphanumeric and dashes)'
            : ''
        }
        fullWidth
        size="small"
        required
        disabled={!!existing}
      />

      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Select Managed Resources
        </Typography>
        {[...mrdsByGroup.entries()].map(([group, groupMRDs], idx) => {
          const selectedCount = groupMRDs.filter(m =>
            selectedMRDs.has(m.metadata.name)
          ).length;
          const allSelected = selectedCount === groupMRDs.length;
          const someSelected = selectedCount > 0;

          return (
            <Accordion
              key={group}
              disableGutters
              elevation={0}
              variant="outlined"
              defaultExpanded={idx === 0}
            >
              <AccordionSummary
                expandIcon={
                  <Typography sx={{ fontSize: '1rem', lineHeight: 1 }}>▾</Typography>
                }
              >
                <FormControlLabel
                  onClick={e => toggleGroup(group, e as MouseEvent)}
                  label={
                    <Typography variant="body2" fontWeight="medium">
                      {group}
                    </Typography>
                  }
                  control={
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      size="small"
                    />
                  }
                />
                <Typography
                  variant="caption"
                  sx={{ mr: 1, alignSelf: 'center', color: 'text.secondary' }}
                >
                  {someSelected ? `${selectedCount}/` : ''}
                  {groupMRDs.length} MRDs
                </Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box display="flex" flexDirection="column" pl={2}>
                  {groupMRDs.map((mrd: any) => (
                    <FormControlLabel
                      key={mrd.metadata.name}
                      label={
                        <Box>
                          <Typography variant="body2">
                            {mrd.jsonData?.spec?.names?.kind ?? mrd.metadata.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {mrd.metadata.name}
                          </Typography>
                        </Box>
                      }
                      control={
                        <Checkbox
                          checked={selectedMRDs.has(mrd.metadata.name)}
                          onChange={() => toggleMRD(mrd.metadata.name)}
                          size="small"
                        />
                      }
                    />
                  ))}
                </Box>
              </AccordionDetails>
            </Accordion>
          );
        })}
      </Box>

      {patterns.length > 0 && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Derived Patterns
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={0.5}>
            {patterns.map(p => (
              <Chip key={p} label={p} size="small" />
            ))}
          </Box>
        </Box>
      )}

      {patterns.length > 0 && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Preview — {previewMatches.length} MRD
            {previewMatches.length !== 1 ? 's' : ''} will be activated
          </Typography>
          <Box display="flex" flexWrap="wrap" gap={0.5}>
            {previewMatches.map((mrd: any) => (
              <Chip
                key={mrd.metadata.name}
                label={mrd.jsonData?.spec?.names?.kind ?? mrd.metadata.name}
                size="small"
                variant="outlined"
              />
            ))}
          </Box>
        </Box>
      )}
    </>
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  existing?: any;
}

export function MRAPCreateDialog({ open, onClose, existing }: DialogProps) {
  const form = useMRAPForm(existing, open);
  return (
    <ResourceHelperDialog
      open={open}
      onClose={onClose}
      resourceName="Activation Policy"
      existing={existing}
      buildItem={form.buildItem}
      canSubmit={form.canSubmit}
      onReset={form.resetForm}
    >
      <MRAPFormFields existing={existing} form={form} />
    </ResourceHelperDialog>
  );
}

interface PanelProps {
  existing?: any;
  onDone?: () => void;
  activityId?: string;
  cluster?: string;
}

export function MRAPCreatePanel({ existing, onDone, activityId, cluster }: PanelProps) {
  const form = useMRAPForm(existing, true);
  return (
    <ResourceHelperPanel
      resourceName="Activation Policy"
      existing={existing}
      buildItem={form.buildItem}
      canSubmit={form.canSubmit}
      onReset={form.resetForm}
      onDone={onDone}
      activityId={activityId}
      cluster={cluster}
    >
      <MRAPFormFields existing={existing} form={form} />
    </ResourceHelperPanel>
  );
}
