import { apply } from '@kinvolk/headlamp-plugin/lib/ApiProxy';
import { EditorDialog } from '@kinvolk/headlamp-plugin/lib/components/common';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { ManagedResourceDefinition } from '../../resources';

interface Props {
  open: boolean;
  onClose: () => void;
}

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

export function MRAPCreateDialog({ open, onClose }: Props) {
  const [mrds] = ManagedResourceDefinition.useList();
  const [name, setName] = useState('');
  const [selectedMRDs, setSelectedMRDs] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nativeEditorItem, setNativeEditorItem] = useState<any>(null);

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
    (group: string, e: React.MouseEvent) => {
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
    setError(null);
  }, []);

  const handleClose = useCallback(() => {
    resetForm();
    onClose();
  }, [resetForm, onClose]);

  const buildItem = useCallback(
    () => ({
      apiVersion: 'apiextensions.crossplane.io/v1alpha1',
      kind: 'ManagedResourceActivationPolicy',
      metadata: { name: name.trim() || '<name>' },
      spec: { activate: patterns },
    }),
    [name, patterns]
  );

  const handleOpenNativeEditor = useCallback(() => {
    const item = buildItem();
    onClose();
    setNativeEditorItem(item);
  }, [buildItem, onClose]);

  const handleNativeEditorClose = useCallback(() => {
    setNativeEditorItem(null);
    resetForm();
  }, [resetForm]);

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await apply(buildItem() as any);
      handleClose();
    } catch (e: any) {
      setError(e?.message ?? 'Failed to create policy');
    } finally {
      setSubmitting(false);
    }
  }, [buildItem, handleClose]);

  const nameError = name.length > 0 && !NAME_REGEX.test(name);
  const canSubmit = !submitting && name.length > 0 && !nameError && patterns.length > 0;

  return (
    <>
      <EditorDialog
        open={!!nativeEditorItem}
        item={nativeEditorItem}
        onClose={handleNativeEditorClose}
        setOpen={v => { if (!v) handleNativeEditorClose(); }}
        onSave="default"
        saveLabel="Apply"
        title="Create Activation Policy"
        PaperProps={{ sx: { height: '80vh' } }}
      />
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box display="flex" justifyContent="space-between" alignItems="center">
            <span>Create Activation Policy</span>
            <Button size="small" onClick={handleOpenNativeEditor}>
              YAML ↗
            </Button>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Box display="flex" flexDirection="column" gap={3} mt={1}>
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
                        onClick={e => toggleGroup(group, e as React.MouseEvent)}
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

            {error && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {error}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} variant="contained" disabled={!canSubmit}>
            {submitting ? 'Creating…' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
