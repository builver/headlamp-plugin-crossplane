import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  ResourceHelperDialog,
  ResourceHelperPanel,
} from '../../components/ResourceHelperDialog';

interface EnvVar {
  name: string;
  value: string;
}

const NAME_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const RUNTIME_KINDS = ['DeploymentRuntimeConfig'] as const;

function parseKV(obj: Record<string, string> | undefined): string[] {
  if (!obj) return [];
  return Object.entries(obj).map(([k, v]) => `${k}=${v}`);
}

function toKV(entries: string[]): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const entry of entries) {
    const idx = entry.indexOf('=');
    if (idx > 0) result[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Build a metadata object from name/labels/annotations, returns undefined if empty. */
function buildMeta(name: string, labels: string[], annotations: string[]): Record<string, unknown> | undefined {
  const meta: Record<string, unknown> = {};
  if (name.trim()) meta.name = name.trim();
  const l = toKV(labels);
  if (l) meta.labels = l;
  const a = toKV(annotations);
  if (a) meta.annotations = a;
  return Object.keys(meta).length > 0 ? meta : undefined;
}

interface MetadataFields {
  name: string;
  labels: string[];
  labelInput: string;
  annotations: string[];
  annotationInput: string;
}

function emptyMeta(): MetadataFields {
  return { name: '', labels: [], labelInput: '', annotations: [], annotationInput: '' };
}

function seedMeta(tpl: any): MetadataFields {
  return {
    name: tpl?.metadata?.name ?? '',
    labels: parseKV(tpl?.metadata?.labels),
    labelInput: '',
    annotations: parseKV(tpl?.metadata?.annotations),
    annotationInput: '',
  };
}

function useRuntimeConfigForm(existing: any | undefined, isOpen: boolean, prefillName?: string) {
  const [name, setName] = useState(prefillName ?? '');
  const [kind, setKind] = useState<string>(RUNTIME_KINDS[0]);

  // ServiceAccount template
  const [sa, setSa] = useState<MetadataFields>(emptyMeta());
  // Service template
  const [svc, setSvc] = useState<MetadataFields>(emptyMeta());
  // Deployment metadata
  const [deploy, setDeploy] = useState<MetadataFields>(emptyMeta());
  // Pod template metadata
  const [pod, setPod] = useState<MetadataFields>(emptyMeta());

  // Deployment spec
  const [replicas, setReplicas] = useState('');

  // Container args & env
  const [containerArgs, setContainerArgs] = useState<string[]>([]);
  const [argInput, setArgInput] = useState('');
  const [envVars, setEnvVars] = useState<EnvVar[]>([]);

  const seededRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      seededRef.current = false;
      return;
    }
    if (!seededRef.current && !existing && prefillName) {
      seededRef.current = true;
      setName(prefillName);
      return;
    }
    if (seededRef.current || !existing) return;
    seededRef.current = true;
    const spec = existing.jsonData?.spec ?? existing.spec;
    setName(existing.metadata?.name ?? '');
    setKind(existing.jsonData?.kind ?? existing.kind ?? RUNTIME_KINDS[0]);

    setSa(seedMeta(spec?.serviceAccountTemplate));
    setSvc(seedMeta(spec?.serviceTemplate));
    setDeploy(seedMeta(spec?.deploymentTemplate));

    const dTpl = spec?.deploymentTemplate;
    setReplicas(dTpl?.spec?.replicas?.toString() ?? '');
    setPod({
      name: dTpl?.spec?.template?.metadata?.name ?? '',
      labels: parseKV(dTpl?.spec?.template?.metadata?.labels),
      labelInput: '',
      annotations: parseKV(dTpl?.spec?.template?.metadata?.annotations),
      annotationInput: '',
    });

    const containers: any[] = dTpl?.spec?.template?.spec?.containers ?? [];
    const rc = containers.find((c: any) => c.name === 'package-runtime') ?? containers[0];
    setContainerArgs(rc?.args ?? []);
    setEnvVars((rc?.env ?? []).map((e: any) => ({ name: e.name ?? '', value: e.value ?? '' })));
  }, [isOpen, existing]);

  const addChip = useCallback(
    (input: string, setInput: (v: string) => void, list: string[], setList: (v: string[]) => void) => {
      const trimmed = input.trim();
      if (trimmed && !list.includes(trimmed)) setList([...list, trimmed]);
      setInput('');
    },
    []
  );

  const resetForm = useCallback(() => {
    setName('');
    setKind(RUNTIME_KINDS[0]);
    setSa(emptyMeta());
    setSvc(emptyMeta());
    setDeploy(emptyMeta());
    setPod(emptyMeta());
    setReplicas('');
    setContainerArgs([]);
    setArgInput('');
    setEnvVars([]);
  }, []);

  const buildItem = useCallback(() => {
    const spec: Record<string, unknown> = {};

    // ServiceAccount template
    const saMeta = buildMeta(sa.name, sa.labels, sa.annotations);
    if (saMeta) spec.serviceAccountTemplate = { metadata: saMeta };

    // Service template
    const svcMeta = buildMeta(svc.name, svc.labels, svc.annotations);
    if (svcMeta) spec.serviceTemplate = { metadata: svcMeta };

    // Deployment template
    const deployMeta = buildMeta(deploy.name, deploy.labels, deploy.annotations);
    const deploySpec: Record<string, unknown> = { selector: {} };
    const replicasNum = parseInt(replicas, 10);
    if (!isNaN(replicasNum) && replicasNum > 0) deploySpec.replicas = replicasNum;

    // Pod template metadata
    const podMeta = buildMeta(pod.name, pod.labels, pod.annotations);

    // Container overrides
    const containerOverride: Record<string, unknown> = { name: 'package-runtime' };
    if (containerArgs.length > 0) containerOverride.args = containerArgs;
    const envFiltered = envVars.filter(e => e.name.trim());
    if (envFiltered.length > 0)
      containerOverride.env = envFiltered.map(e => ({ name: e.name.trim(), value: e.value }));

    const hasContainerOverride = containerArgs.length > 0 || envFiltered.length > 0;
    const hasPodTemplate = podMeta || hasContainerOverride;
    if (hasPodTemplate) {
      const template: Record<string, unknown> = {};
      if (podMeta) template.metadata = podMeta;
      if (hasContainerOverride) template.spec = { containers: [containerOverride] };
      deploySpec.template = template;
    }

    const hasDeploySpec = hasPodTemplate || !isNaN(replicasNum);
    if (hasDeploySpec || deployMeta) {
      const deployTpl: Record<string, unknown> = {};
      if (deployMeta) deployTpl.metadata = deployMeta;
      if (hasDeploySpec) deployTpl.spec = deploySpec;
      spec.deploymentTemplate = deployTpl;
    }

    if (existing) {
      return { ...structuredClone(existing.jsonData), spec: { ...existing.jsonData.spec, ...spec } };
    }
    return { apiVersion: 'pkg.crossplane.io/v1beta1', kind, metadata: { name: name.trim() || '<name>' }, spec };
  }, [existing, name, kind, sa, svc, deploy, pod, replicas, containerArgs, envVars]);

  const nameError = name.length > 0 && !NAME_REGEX.test(name);
  const canSubmit = name.length > 0 && !nameError;

  return {
    name, setName, kind, setKind, nameError, canSubmit, buildItem, resetForm,
    sa, setSa, svc, setSvc, deploy, setDeploy, pod, setPod,
    replicas, setReplicas,
    containerArgs, setContainerArgs, argInput, setArgInput,
    envVars, setEnvVars,
    addChip,
  };
}

function MetadataSection({
  title,
  meta,
  setMeta,
  addChip,
  showName = true,
  nameHelperText = 'Override the generated name (optional)',
}: {
  title: string;
  meta: MetadataFields;
  setMeta: (m: MetadataFields) => void;
  addChip: (input: string, setInput: (v: string) => void, list: string[], setList: (v: string[]) => void) => void;
  showName?: boolean;
  nameHelperText?: string;
}) {
  const updateLabels = (labels: string[]) => setMeta({ ...meta, labels });
  const updateAnnotations = (annotations: string[]) => setMeta({ ...meta, annotations });

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>{title}</Typography>
      <Box display="flex" flexDirection="column" gap={2}>
        {showName && (
          <TextField
            label="Name"
            value={meta.name}
            onChange={e => setMeta({ ...meta, name: e.target.value })}
            fullWidth
            size="small"
            helperText={nameHelperText}
          />
        )}
        <ChipListInput
          label="Labels"
          placeholder="app=my-provider"
          value={meta.labelInput}
          onChange={v => setMeta({ ...meta, labelInput: v })}
          chips={meta.labels}
          onAdd={() => addChip(meta.labelInput, v => setMeta({ ...meta, labelInput: v }), meta.labels, updateLabels)}
          onDelete={v => updateLabels(meta.labels.filter(l => l !== v))}
        />
        <ChipListInput
          label="Annotations"
          placeholder="example.com/key=value"
          value={meta.annotationInput}
          onChange={v => setMeta({ ...meta, annotationInput: v })}
          chips={meta.annotations}
          onAdd={() => addChip(meta.annotationInput, v => setMeta({ ...meta, annotationInput: v }), meta.annotations, updateAnnotations)}
          onDelete={v => updateAnnotations(meta.annotations.filter(a => a !== v))}
        />
      </Box>
    </Box>
  );
}

function RuntimeConfigFormFields({
  existing,
  form,
}: {
  existing: any;
  form: ReturnType<typeof useRuntimeConfigForm>;
}) {
  const {
    name, setName, kind, setKind, nameError,
    sa, setSa, svc, setSvc, deploy, setDeploy, pod, setPod,
    replicas, setReplicas,
    containerArgs, setContainerArgs, argInput, setArgInput,
    envVars, setEnvVars,
    addChip,
  } = form;

  return (
    <>
      <TextField
        label="Name"
        value={name}
        onChange={e => setName(e.target.value)}
        error={nameError}
        helperText={nameError ? 'Must be a valid Kubernetes name (lowercase alphanumeric, dashes, and dots)' : ''}
        fullWidth
        size="small"
        required
        disabled={!!existing}
      />

      <TextField
        label="Kind"
        value={kind}
        onChange={e => setKind(e.target.value)}
        fullWidth
        size="small"
        select
        disabled={!!existing}
      >
        {RUNTIME_KINDS.map(k => (
          <MenuItem key={k} value={k}>{k}</MenuItem>
        ))}
      </TextField>

      <Divider />
      <MetadataSection
        title="ServiceAccount"
        meta={sa}
        setMeta={setSa}
        addChip={addChip}
        nameHelperText="Override the generated ServiceAccount name (optional)"
      />

      <Divider />
      <MetadataSection
        title="Service"
        meta={svc}
        setMeta={setSvc}
        addChip={addChip}
        nameHelperText="Override the generated Service name (optional)"
      />

      <Divider />
      <MetadataSection
        title="Deployment"
        meta={deploy}
        setMeta={setDeploy}
        addChip={addChip}
        nameHelperText="Override the generated Deployment name (optional)"
      />

      <Divider />
      <Box>
        <Typography variant="subtitle2" gutterBottom>Deployment Spec</Typography>
        <Box display="flex" flexDirection="column" gap={2}>
          <TextField
            label="Replicas"
            value={replicas}
            onChange={e => setReplicas(e.target.value)}
            fullWidth
            size="small"
            type="number"
            helperText="Number of replicas (defaults to 1)"
          />
        </Box>
      </Box>

      <Divider />
      <MetadataSection
        title="Pod Template"
        meta={pod}
        setMeta={setPod}
        addChip={addChip}
        showName={false}
      />

      <Divider />
      <Box>
        <Typography variant="subtitle2" gutterBottom>Container (package-runtime)</Typography>
        <Box display="flex" flexDirection="column" gap={2}>
          <ChipListInput
            label="Args"
            placeholder="--enable-external-secret-stores"
            value={argInput}
            onChange={setArgInput}
            chips={containerArgs}
            onAdd={() => addChip(argInput, setArgInput, containerArgs, setContainerArgs)}
            onDelete={v => setContainerArgs(prev => prev.filter(a => a !== v))}
          />
          <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
              <Typography variant="body2" fontWeight="medium">Environment Variables</Typography>
              <Button size="small" startIcon={<Icon icon="mdi:plus" />} onClick={() => setEnvVars(prev => [...prev, { name: '', value: '' }])}>
                Add
              </Button>
            </Box>
            {envVars.map((env, idx) => (
              <Box key={idx} display="flex" gap={1} alignItems="flex-start" mb={1}>
                <TextField
                  label="Name"
                  value={env.name}
                  onChange={e => { const next = [...envVars]; next[idx] = { ...next[idx], name: e.target.value }; setEnvVars(next); }}
                  size="small"
                  sx={{ flex: 1 }}
                />
                <TextField
                  label="Value"
                  value={env.value}
                  onChange={e => { const next = [...envVars]; next[idx] = { ...next[idx], value: e.target.value }; setEnvVars(next); }}
                  size="small"
                  sx={{ flex: 2 }}
                />
                <IconButton size="small" onClick={() => setEnvVars(prev => prev.filter((_, i) => i !== idx))}>
                  <Icon icon="mdi:close" />
                </IconButton>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </>
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  existing?: any;
  prefillName?: string;
  onCreated?: (name: string) => void;
}

export function RuntimeConfigCreateDialog({ open, onClose, existing, prefillName, onCreated }: DialogProps) {
  const form = useRuntimeConfigForm(existing, open, prefillName);

  const handleSuccess = useCallback(() => {
    onCreated?.(form.name.trim());
  }, [form.name, onCreated]);

  return (
    <ResourceHelperDialog
      open={open}
      onClose={onClose}
      resourceName="Runtime Config"
      existing={existing}
      buildItem={form.buildItem}
      canSubmit={form.canSubmit}
      onReset={form.resetForm}
      onSuccess={onCreated ? handleSuccess : undefined}
    >
      <RuntimeConfigFormFields existing={existing} form={form} />
    </ResourceHelperDialog>
  );
}

interface PanelProps {
  existing?: any;
  prefillName?: string;
  onDone?: () => void;
  activityId?: string;
  cluster?: string;
}

export function RuntimeConfigCreatePanel({ existing, prefillName, onDone, activityId, cluster }: PanelProps) {
  const form = useRuntimeConfigForm(existing, true, prefillName);
  return (
    <ResourceHelperPanel
      resourceName="Runtime Config"
      existing={existing}
      buildItem={form.buildItem}
      canSubmit={form.canSubmit}
      onReset={form.resetForm}
      onDone={onDone}
      activityId={activityId}
      cluster={cluster}
    >
      <RuntimeConfigFormFields existing={existing} form={form} />
    </ResourceHelperPanel>
  );
}

function ChipListInput({
  label, placeholder, value, onChange, chips, onAdd, onDelete,
}: {
  label: string; placeholder: string; value: string; onChange: (v: string) => void;
  chips: string[]; onAdd: () => void; onDelete: (v: string) => void;
  children?: ReactNode;
}) {
  return (
    <Box>
      <Box display="flex" gap={1} alignItems="flex-start">
        <TextField
          label={label} value={value} onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd(); } }}
          fullWidth size="small" placeholder={placeholder}
        />
        <IconButton onClick={onAdd} disabled={!value.trim()} size="small">
          <Icon icon="mdi:plus-circle" />
        </IconButton>
      </Box>
      {chips.length > 0 && (
        <Box display="flex" flexWrap="wrap" gap={0.5} mt={1}>
          {chips.map(c => (<Chip key={c} label={c} size="small" onDelete={() => onDelete(c)} />))}
        </Box>
      )}
    </Box>
  );
}
