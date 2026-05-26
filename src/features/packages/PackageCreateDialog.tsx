import { Icon } from '@iconify/react';
import {
  Box,
  Chip,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ResourceHelperDialog,
  ResourceHelperPanel,
} from '../../components/ResourceHelperDialog';
import { RuntimeConfigRefField } from '../../components/RuntimeConfigRefField';

type PackageKind = 'Provider' | 'Function' | 'Configuration';

const PULL_POLICIES = ['IfNotPresent', 'Always', 'Never'] as const;
const ACTIVATION_POLICIES = ['Automatic', 'Manual'] as const;
const NAME_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function usePackageForm(kind: PackageKind, existing: any | undefined, isOpen: boolean) {
  const [name, setName] = useState('');
  const [pkg, setPkg] = useState('');
  const [pullPolicy, setPullPolicy] = useState('');
  const [activationPolicy, setActivationPolicy] = useState('');
  const [revisionHistoryLimit, setRevisionHistoryLimit] = useState('');
  const [runtimeConfigRef, setRuntimeConfigRef] = useState('');
  const [skipDependencyResolution, setSkipDependencyResolution] = useState(false);
  const [ignoreCrossplaneConstraints, setIgnoreCrossplaneConstraints] = useState(false);
  const [pullSecrets, setPullSecrets] = useState<string[]>([]);
  const [pullSecretInput, setPullSecretInput] = useState('');
  const [commonLabels, setCommonLabels] = useState<string[]>([]);
  const [commonLabelInput, setCommonLabelInput] = useState('');

  const seededRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || !existing) return;
    seededRef.current = true;
    const spec = existing.jsonData?.spec;
    setName(existing.metadata?.name ?? '');
    setPkg(spec?.package ?? '');
    setPullPolicy(spec?.packagePullPolicy ?? '');
    setActivationPolicy(spec?.revisionActivationPolicy ?? '');
    setRevisionHistoryLimit(spec?.revisionHistoryLimit?.toString() ?? '');
    setRuntimeConfigRef(spec?.runtimeConfigRef?.name ?? '');
    setSkipDependencyResolution(spec?.skipDependencyResolution === true);
    setIgnoreCrossplaneConstraints(spec?.ignoreCrossplaneConstraints === true);
    setPullSecrets(
      (spec?.packagePullSecrets ?? []).map((s: any) => s.name).filter(Boolean)
    );
    const labels = spec?.commonLabels;
    setCommonLabels(labels ? Object.entries(labels).map(([k, v]) => `${k}=${v}`) : []);
  }, [isOpen, existing]);

  const addPullSecret = useCallback(() => {
    const trimmed = pullSecretInput.trim();
    if (trimmed && !pullSecrets.includes(trimmed)) {
      setPullSecrets(prev => [...prev, trimmed]);
    }
    setPullSecretInput('');
  }, [pullSecretInput, pullSecrets]);

  const resetForm = useCallback(() => {
    setName('');
    setPkg('');
    setPullPolicy('');
    setActivationPolicy('');
    setRevisionHistoryLimit('');
    setRuntimeConfigRef('');
    setSkipDependencyResolution(false);
    setIgnoreCrossplaneConstraints(false);
    setPullSecrets([]);
    setPullSecretInput('');
    setCommonLabels([]);
    setCommonLabelInput('');
  }, []);

  const buildItem = useCallback(() => {
    const spec: Record<string, unknown> = {};
    const pkgTrimmed = pkg.trim();
    if (pkgTrimmed) spec.package = pkgTrimmed;
    if (pullPolicy) spec.packagePullPolicy = pullPolicy;
    if (activationPolicy) spec.revisionActivationPolicy = activationPolicy;
    const histLimit = parseInt(revisionHistoryLimit, 10);
    if (!isNaN(histLimit) && histLimit >= 0) spec.revisionHistoryLimit = histLimit;
    const rtRef = runtimeConfigRef.trim();
    if (rtRef) {
      spec.runtimeConfigRef = {
        apiVersion: 'pkg.crossplane.io/v1beta1',
        kind: 'DeploymentRuntimeConfig',
        name: rtRef,
      };
    }
    if (skipDependencyResolution) spec.skipDependencyResolution = true;
    if (ignoreCrossplaneConstraints) spec.ignoreCrossplaneConstraints = true;
    if (pullSecrets.length > 0) spec.packagePullSecrets = pullSecrets.map(s => ({ name: s }));
    if (commonLabels.length > 0) {
      const labels: Record<string, string> = {};
      for (const entry of commonLabels) {
        const idx = entry.indexOf('=');
        if (idx > 0) labels[entry.slice(0, idx)] = entry.slice(idx + 1);
      }
      if (Object.keys(labels).length > 0) spec.commonLabels = labels;
    }

    if (existing) {
      return { ...structuredClone(existing.jsonData), spec: { ...existing.jsonData.spec, ...spec } };
    }
    return {
      apiVersion: 'pkg.crossplane.io/v1',
      kind,
      metadata: { name: name.trim() || '<name>' },
      spec,
    };
  }, [existing, kind, name, pkg, pullPolicy, activationPolicy, revisionHistoryLimit, runtimeConfigRef, skipDependencyResolution, ignoreCrossplaneConstraints, pullSecrets, commonLabels]);

  const nameError = name.length > 0 && !NAME_REGEX.test(name);
  const canSubmit = name.length > 0 && !nameError && pkg.trim().length > 0;

  return {
    name, setName, nameError, canSubmit, buildItem, resetForm,
    pkg, setPkg,
    pullPolicy, setPullPolicy,
    activationPolicy, setActivationPolicy,
    revisionHistoryLimit, setRevisionHistoryLimit,
    runtimeConfigRef, setRuntimeConfigRef,
    skipDependencyResolution, setSkipDependencyResolution,
    ignoreCrossplaneConstraints, setIgnoreCrossplaneConstraints,
    pullSecrets, setPullSecrets, pullSecretInput, setPullSecretInput, addPullSecret,
    commonLabels, setCommonLabels, commonLabelInput, setCommonLabelInput,
  };
}

function PackageFormFields({
  kind,
  existing,
  form,
}: {
  kind: PackageKind;
  existing: any;
  form: ReturnType<typeof usePackageForm>;
}) {
  const {
    name, setName, nameError,
    pkg, setPkg,
    pullPolicy, setPullPolicy,
    activationPolicy, setActivationPolicy,
    revisionHistoryLimit, setRevisionHistoryLimit,
    runtimeConfigRef, setRuntimeConfigRef,
    skipDependencyResolution, setSkipDependencyResolution,
    ignoreCrossplaneConstraints, setIgnoreCrossplaneConstraints,
    pullSecrets, setPullSecrets, pullSecretInput, setPullSecretInput, addPullSecret,
    commonLabels, setCommonLabels, commonLabelInput, setCommonLabelInput,
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

      <TextField
        label="Package"
        value={pkg}
        onChange={e => setPkg(e.target.value)}
        fullWidth
        size="small"
        required
        placeholder="xpkg.crossplane.io/crossplane-contrib/provider-aws-s3:v2.0.0"
        helperText="OCI image reference for the package"
      />

      <TextField
        label="Package Pull Policy"
        value={pullPolicy}
        onChange={e => setPullPolicy(e.target.value)}
        fullWidth
        size="small"
        select
        helperText="Defaults to IfNotPresent"
      >
        <MenuItem value="">
          <em>Default (IfNotPresent)</em>
        </MenuItem>
        {PULL_POLICIES.map(p => (
          <MenuItem key={p} value={p}>{p}</MenuItem>
        ))}
      </TextField>

      <TextField
        label="Revision Activation Policy"
        value={activationPolicy}
        onChange={e => setActivationPolicy(e.target.value)}
        fullWidth
        size="small"
        select
        helperText="Defaults to Automatic"
      >
        <MenuItem value="">
          <em>Default (Automatic)</em>
        </MenuItem>
        {ACTIVATION_POLICIES.map(p => (
          <MenuItem key={p} value={p}>{p}</MenuItem>
        ))}
      </TextField>

      <TextField
        label="Revision History Limit"
        value={revisionHistoryLimit}
        onChange={e => setRevisionHistoryLimit(e.target.value)}
        fullWidth
        size="small"
        type="number"
        helperText="Number of revisions to keep (defaults to 1, 0 to disable)"
      />

      {kind !== 'Configuration' && (
        <RuntimeConfigRefField value={runtimeConfigRef} onChange={setRuntimeConfigRef} />
      )}

      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Pull Secrets
        </Typography>
        <Box display="flex" gap={1} alignItems="flex-start">
          <TextField
            label="Add pull secret"
            value={pullSecretInput}
            onChange={e => setPullSecretInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addPullSecret();
              }
            }}
            fullWidth
            size="small"
            placeholder="my-registry-secret"
          />
          <IconButton onClick={addPullSecret} disabled={!pullSecretInput.trim()} size="small">
            <Icon icon="mdi:plus-circle" />
          </IconButton>
        </Box>
        {pullSecrets.length > 0 && (
          <Box display="flex" flexWrap="wrap" gap={0.5} mt={1}>
            {pullSecrets.map(s => (
              <Chip
                key={s}
                label={s}
                size="small"
                onDelete={() => setPullSecrets(prev => prev.filter(p => p !== s))}
              />
            ))}
          </Box>
        )}
      </Box>

      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Common Labels
        </Typography>
        <Box display="flex" gap={1} alignItems="flex-start">
          <TextField
            label="Add label"
            value={commonLabelInput}
            onChange={e => setCommonLabelInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                const trimmed = commonLabelInput.trim();
                if (trimmed && !commonLabels.includes(trimmed)) {
                  setCommonLabels(prev => [...prev, trimmed]);
                }
                setCommonLabelInput('');
              }
            }}
            fullWidth
            size="small"
            placeholder="app.kubernetes.io/managed-by=crossplane"
          />
          <IconButton
            onClick={() => {
              const trimmed = commonLabelInput.trim();
              if (trimmed && !commonLabels.includes(trimmed)) {
                setCommonLabels(prev => [...prev, trimmed]);
              }
              setCommonLabelInput('');
            }}
            disabled={!commonLabelInput.trim()}
            size="small"
          >
            <Icon icon="mdi:plus-circle" />
          </IconButton>
        </Box>
        {commonLabels.length > 0 && (
          <Box display="flex" flexWrap="wrap" gap={0.5} mt={1}>
            {commonLabels.map(l => (
              <Chip key={l} label={l} size="small" onDelete={() => setCommonLabels(prev => prev.filter(x => x !== l))} />
            ))}
          </Box>
        )}
      </Box>

      <Box display="flex" alignItems="center" gap={1}>
        <Switch
          checked={skipDependencyResolution}
          onChange={e => setSkipDependencyResolution(e.target.checked)}
          size="small"
        />
        <Typography variant="body2">Skip dependency resolution</Typography>
      </Box>

      <Box display="flex" alignItems="center" gap={1}>
        <Switch
          checked={ignoreCrossplaneConstraints}
          onChange={e => setIgnoreCrossplaneConstraints(e.target.checked)}
          size="small"
        />
        <Typography variant="body2">Ignore Crossplane version constraints</Typography>
      </Box>
    </>
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  kind: PackageKind;
  existing?: any;
}

export function PackageCreateDialog({ open, onClose, kind, existing }: DialogProps) {
  const form = usePackageForm(kind, existing, open);
  return (
    <ResourceHelperDialog
      open={open}
      onClose={onClose}
      resourceName={kind}
      existing={existing}
      buildItem={form.buildItem}
      canSubmit={form.canSubmit}
      onReset={form.resetForm}
    >
      <PackageFormFields kind={kind} existing={existing} form={form} />
    </ResourceHelperDialog>
  );
}

interface PanelProps {
  kind: PackageKind;
  existing?: any;
  onDone?: () => void;
}

export function PackageCreatePanel({ kind, existing, onDone }: PanelProps) {
  const form = usePackageForm(kind, existing, true);
  return (
    <ResourceHelperPanel
      resourceName={kind}
      existing={existing}
      buildItem={form.buildItem}
      canSubmit={form.canSubmit}
      onReset={form.resetForm}
      onDone={onDone}
    >
      <PackageFormFields kind={kind} existing={existing} form={form} />
    </ResourceHelperPanel>
  );
}

