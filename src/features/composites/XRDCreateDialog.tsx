import { Icon } from '@iconify/react';
import {
  Autocomplete,
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ResourceHelperPanel } from '../../components/ResourceHelperDialog';
import { Composition } from '../../resources';

const NAME_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
const DNS_LABEL_REGEX = /^[a-z][a-z0-9]*$/;
const FIELD_KEY_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

type ApiVersion = 'apiextensions.crossplane.io/v2' | 'apiextensions.crossplane.io/v1';
type Scope = 'Namespaced' | 'Cluster' | 'LegacyCluster';

type FieldType =
  | 'string'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'string-array'
  | 'object'
  | 'object-array';

interface FieldEntry {
  key: string;
  type: FieldType;
  description: string;
  defaultValue: string;
  required: boolean;
  children: FieldEntry[];
}

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'string', label: 'string' },
  { value: 'integer', label: 'integer' },
  { value: 'number', label: 'number' },
  { value: 'boolean', label: 'boolean' },
  { value: 'string-array', label: 'string[]' },
  { value: 'object', label: 'object (nested)' },
  { value: 'object-array', label: 'object[] (nested)' },
];

function emptyField(): FieldEntry {
  return { key: '', type: 'string', description: '', defaultValue: '', required: false, children: [] };
}

function isContainer(t: FieldType): boolean {
  return t === 'object' || t === 'object-array';
}

function parseDefault(type: FieldType, raw: string): unknown {
  const t = raw.trim();
  if (!t) return undefined;
  if (type === 'integer') {
    const n = parseInt(t, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'number') {
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : undefined;
  }
  if (type === 'boolean') return t.toLowerCase() === 'true';
  if (type === 'string-array') {
    return t.split(',').map(s => s.trim()).filter(Boolean);
  }
  return t;
}

function fieldToSchema(field: FieldEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (field.description.trim()) out.description = field.description.trim();

  switch (field.type) {
    case 'string':
    case 'integer':
    case 'number':
    case 'boolean':
      out.type = field.type;
      break;
    case 'string-array':
      out.type = 'array';
      out.items = { type: 'string' };
      break;
    case 'object': {
      out.type = 'object';
      assignChildSchema(out, field.children);
      break;
    }
    case 'object-array': {
      out.type = 'array';
      const item: Record<string, unknown> = { type: 'object' };
      assignChildSchema(item, field.children);
      out.items = item;
      break;
    }
  }

  if (!isContainer(field.type)) {
    const def = parseDefault(field.type, field.defaultValue);
    if (def !== undefined) out.default = def;
  }
  return out;
}

function assignChildSchema(target: Record<string, unknown>, children: FieldEntry[]) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const child of children) {
    const k = child.key.trim();
    if (!k) continue;
    properties[k] = fieldToSchema(child);
    if (child.required) required.push(k);
  }
  if (Object.keys(properties).length > 0) {
    target.properties = properties;
    if (required.length > 0) target.required = required;
  } else {
    target['x-kubernetes-preserve-unknown-fields'] = true;
  }
}

function schemaToFields(properties: Record<string, any> | undefined, required: Set<string>): FieldEntry[] {
  if (!properties) return [];
  return Object.entries(properties).map(([key, raw]) => {
    const entry: FieldEntry = {
      key,
      type: 'string',
      description: raw?.description ?? '',
      defaultValue: '',
      required: required.has(key),
      children: [],
    };

    const t = raw?.type;
    if (t === 'array' && raw?.items?.type === 'string') {
      entry.type = 'string-array';
    } else if (t === 'array' && raw?.items?.type === 'object') {
      entry.type = 'object-array';
      entry.children = schemaToFields(
        raw.items?.properties,
        new Set(raw.items?.required ?? []),
      );
    } else if (t === 'object') {
      entry.type = 'object';
      entry.children = schemaToFields(raw?.properties, new Set(raw?.required ?? []));
    } else if (['string', 'integer', 'number', 'boolean'].includes(t)) {
      entry.type = t;
    }

    if (raw?.default !== undefined && !isContainer(entry.type)) {
      if (Array.isArray(raw.default)) entry.defaultValue = raw.default.join(', ');
      else entry.defaultValue = String(raw.default);
    }
    return entry;
  });
}

function fieldsToSpecSchema(fields: FieldEntry[]): Record<string, unknown> {
  const out: Record<string, unknown> = { type: 'object' };
  assignChildSchema(out, fields);
  return out;
}

// ── Tree edits ────────────────────────────────────────────────────────────────

type Path = number[];

function setAtPath(
  fields: FieldEntry[],
  path: Path,
  updater: (f: FieldEntry) => FieldEntry,
): FieldEntry[] {
  if (path.length === 0) return fields;
  const [head, ...rest] = path;
  return fields.map((f, i) => {
    if (i !== head) return f;
    if (rest.length === 0) return updater(f);
    return { ...f, children: setAtPath(f.children, rest, updater) };
  });
}

function removeAtPath(fields: FieldEntry[], path: Path): FieldEntry[] {
  if (path.length === 0) return fields;
  const [head, ...rest] = path;
  if (rest.length === 0) return fields.filter((_, i) => i !== head);
  return fields.map((f, i) => {
    if (i !== head) return f;
    return { ...f, children: removeAtPath(f.children, rest) };
  });
}

function addChildAtPath(fields: FieldEntry[], path: Path): FieldEntry[] {
  return setAtPath(fields, path, f => ({ ...f, children: [...f.children, emptyField()] }));
}

function collectKeyErrors(fields: FieldEntry[], prefix: Path = []): Set<string> {
  const errors = new Set<string>();
  const seen = new Map<string, number>();
  fields.forEach((f, i) => {
    const path = [...prefix, i];
    const k = f.key.trim();
    if (k) {
      if (!FIELD_KEY_REGEX.test(k)) errors.add(path.join('.'));
      const prev = seen.get(k);
      if (prev !== undefined) {
        errors.add(path.join('.'));
        errors.add([...prefix, prev].join('.'));
      } else {
        seen.set(k, i);
      }
    }
    const childErrors = collectKeyErrors(f.children, path);
    childErrors.forEach(e => errors.add(e));
  });
  return errors;
}

// ── Form hook ─────────────────────────────────────────────────────────────────

function useXRDForm(existing: any | undefined, isOpen: boolean) {
  const [compositions] = Composition.useList();
  const [apiVersion, setApiVersion] = useState<ApiVersion>('apiextensions.crossplane.io/v2');
  const [scope, setScope] = useState<Scope>('Namespaced');
  const [group, setGroup] = useState('');
  const [kind, setKind] = useState('');
  const [plural, setPlural] = useState('');
  const [singular, setSingular] = useState('');
  const [versionName, setVersionName] = useState('v1alpha1');
  const [served, setServed] = useState(true);
  const [referenceable, setReferenceable] = useState(true);
  const [specFields, setSpecFields] = useState<FieldEntry[]>([]);
  const [statusFields, setStatusFields] = useState<FieldEntry[]>([]);
  const [defaultComposition, setDefaultComposition] = useState('');
  const [claimKind, setClaimKind] = useState('');
  const [claimPlural, setClaimPlural] = useState('');

  const seededRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || !existing) return;
    seededRef.current = true;
    const data = existing.jsonData ?? {};
    const ev = (data.apiVersion as ApiVersion) ?? 'apiextensions.crossplane.io/v2';
    setApiVersion(ev);
    const s = data?.spec ?? {};
    const sc = s.scope as 'Namespaced' | 'Cluster' | undefined;
    setScope(ev === 'apiextensions.crossplane.io/v1' ? 'LegacyCluster' : (sc ?? 'Namespaced'));
    setGroup(s.group ?? '');
    setKind(s.names?.kind ?? '');
    setPlural(s.names?.plural ?? '');
    setSingular(s.names?.singular ?? '');
    const v = (s.versions ?? [])[0] ?? {};
    setVersionName(v.name ?? 'v1alpha1');
    setServed(v.served !== false);
    setReferenceable(v.referenceable !== false);

    const specSchema = v.schema?.openAPIV3Schema?.properties?.spec;
    setSpecFields(schemaToFields(specSchema?.properties, new Set(specSchema?.required ?? [])));

    const statusSchema = v.schema?.openAPIV3Schema?.properties?.status;
    setStatusFields(schemaToFields(statusSchema?.properties, new Set(statusSchema?.required ?? [])));

    setDefaultComposition(s.defaultCompositionRef?.name ?? '');
    setClaimKind(s.claimNames?.kind ?? '');
    setClaimPlural(s.claimNames?.plural ?? '');
  }, [isOpen, existing]);

  useEffect(() => {
    if (apiVersion === 'apiextensions.crossplane.io/v1' && scope !== 'LegacyCluster') {
      setScope('LegacyCluster');
    }
    if (apiVersion === 'apiextensions.crossplane.io/v2' && scope === 'LegacyCluster') {
      setScope('Namespaced');
    }
  }, [apiVersion, scope]);

  const derivedName = useMemo(() => {
    if (!group || !plural) return '';
    return `${plural}.${group}`;
  }, [group, plural]);

  const matchingCompositions = useMemo(() => {
    if (!compositions || !group || !kind) return compositions ?? [];
    const refApi = `${group}/${versionName}`;
    return compositions.filter((c: any) => {
      const ref = c.jsonData?.spec?.compositeTypeRef;
      return ref?.apiVersion === refApi && ref?.kind === kind;
    });
  }, [compositions, group, kind, versionName]);

  const compositionNames = useMemo(
    () => matchingCompositions.map((c: any) => c.metadata.name as string),
    [matchingCompositions]
  );

  const updateSpecField = useCallback((path: Path, patch: Partial<FieldEntry>) => {
    setSpecFields(prev => setAtPath(prev, path, f => ({ ...f, ...patch })));
  }, []);
  const removeSpecField = useCallback((path: Path) => {
    setSpecFields(prev => removeAtPath(prev, path));
  }, []);
  const addSpecChild = useCallback((path: Path) => {
    setSpecFields(prev =>
      path.length === 0 ? [...prev, emptyField()] : addChildAtPath(prev, path)
    );
  }, []);

  const updateStatusField = useCallback((path: Path, patch: Partial<FieldEntry>) => {
    setStatusFields(prev => setAtPath(prev, path, f => ({ ...f, ...patch })));
  }, []);
  const removeStatusField = useCallback((path: Path) => {
    setStatusFields(prev => removeAtPath(prev, path));
  }, []);
  const addStatusChild = useCallback((path: Path) => {
    setStatusFields(prev =>
      path.length === 0 ? [...prev, emptyField()] : addChildAtPath(prev, path)
    );
  }, []);

  const specKeyErrors = useMemo(() => collectKeyErrors(specFields), [specFields]);
  const statusKeyErrors = useMemo(() => collectKeyErrors(statusFields), [statusFields]);

  const resetForm = useCallback(() => {
    setApiVersion('apiextensions.crossplane.io/v2');
    setScope('Namespaced');
    setGroup('');
    setKind('');
    setPlural('');
    setSingular('');
    setVersionName('v1alpha1');
    setServed(true);
    setReferenceable(true);
    setSpecFields([]);
    setStatusFields([]);
    setDefaultComposition('');
    setClaimKind('');
    setClaimPlural('');
    seededRef.current = false;
  }, []);

  const buildItem = useCallback(() => {
    const schemaProperties: Record<string, unknown> = {
      spec: fieldsToSpecSchema(specFields),
    };
    if (statusFields.length > 0) {
      schemaProperties.status = fieldsToSpecSchema(statusFields);
    }

    const openAPIV3Schema: Record<string, unknown> = {
      type: 'object',
      properties: schemaProperties,
    };

    const version: Record<string, unknown> = {
      name: versionName.trim() || 'v1alpha1',
      served,
      referenceable,
      schema: { openAPIV3Schema },
    };
    if (apiVersion === 'apiextensions.crossplane.io/v1') {
      version.storage = referenceable;
    }

    const names: Record<string, unknown> = {
      kind: kind.trim(),
      plural: plural.trim(),
    };
    if (singular.trim()) names.singular = singular.trim();

    const spec: Record<string, unknown> = {
      group: group.trim(),
      names,
      versions: [version],
    };
    if (apiVersion === 'apiextensions.crossplane.io/v2') {
      spec.scope = scope === 'LegacyCluster' ? 'Cluster' : scope;
    }
    if (defaultComposition.trim()) {
      spec.defaultCompositionRef = { name: defaultComposition.trim() };
    }
    if (scope === 'LegacyCluster' && claimKind.trim() && claimPlural.trim()) {
      spec.claimNames = { kind: claimKind.trim(), plural: claimPlural.trim() };
    }

    const metadata = { name: derivedName || '<name>' };

    if (existing) {
      return {
        ...structuredClone(existing.jsonData),
        apiVersion,
        spec: { ...existing.jsonData.spec, ...spec },
      };
    }
    return { apiVersion, kind: 'CompositeResourceDefinition', metadata, spec };
  }, [
    existing, apiVersion, scope, group, kind, plural, singular,
    versionName, served, referenceable, specFields, statusFields,
    defaultComposition, claimKind, claimPlural, derivedName,
  ]);

  const groupError = group.length > 0 && !NAME_REGEX.test(group);
  const kindError = kind.length > 0 && !/^[A-Z][A-Za-z0-9]*$/.test(kind);
  const pluralError = plural.length > 0 && !DNS_LABEL_REGEX.test(plural);
  const versionError = versionName.length > 0 && !/^v\d+([a-z]+\d+)?$/.test(versionName);

  const canSubmit =
    !!group && !groupError &&
    !!kind && !kindError &&
    !!plural && !pluralError &&
    !!versionName && !versionError &&
    specKeyErrors.size === 0 &&
    statusKeyErrors.size === 0 &&
    (scope !== 'LegacyCluster' || !claimKind || !!claimPlural);

  return {
    apiVersion, setApiVersion,
    scope, setScope,
    group, setGroup, groupError,
    kind, setKind, kindError,
    plural, setPlural, pluralError,
    singular, setSingular,
    versionName, setVersionName, versionError,
    served, setServed,
    referenceable, setReferenceable,
    specFields, addSpecChild, updateSpecField, removeSpecField, specKeyErrors,
    statusFields, addStatusChild, updateStatusField, removeStatusField, statusKeyErrors,
    defaultComposition, setDefaultComposition, compositionNames,
    claimKind, setClaimKind, claimPlural, setClaimPlural,
    derivedName,
    canSubmit, buildItem, resetForm,
  };
}

// ── Recursive field editor ────────────────────────────────────────────────────

interface FieldRowProps {
  field: FieldEntry;
  path: Path;
  errors: Set<string>;
  onUpdate: (path: Path, patch: Partial<FieldEntry>) => void;
  onRemove: (path: Path) => void;
  onAddChild: (path: Path) => void;
}

function FieldRow({ field, path, errors, onUpdate, onRemove, onAddChild }: FieldRowProps) {
  const [expanded, setExpanded] = useState(true);
  const pathKey = path.join('.');
  const hasError = errors.has(pathKey);
  const container = isContainer(field.type);

  return (
    <Box
      display="flex"
      flexDirection="column"
      gap={0.5}
      mb={1}
      ml={1}
      pl={1}
      borderLeft={2}
      borderColor="divider"
    >
      <Box display="flex" gap={0.5} alignItems="flex-start">
        {container ? (
          <IconButton
            size="small"
            onClick={() => setExpanded(e => !e)}
            sx={{ mt: 0.5 }}
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <Icon icon={expanded ? 'mdi:chevron-down' : 'mdi:chevron-right'} width="1rem" />
          </IconButton>
        ) : (
          <Box sx={{ width: 30, flexShrink: 0 }} />
        )}
        <TextField
          label="Field name"
          value={field.key}
          onChange={e => onUpdate(path, { key: e.target.value })}
          size="small"
          error={hasError}
          helperText={hasError ? 'Must be a unique camelCase identifier' : ''}
          required
          sx={{ flex: 2 }}
        />
        <TextField
          label="Type"
          value={field.type}
          onChange={e => onUpdate(path, { type: e.target.value as FieldType })}
          select
          size="small"
          sx={{ flex: 2 }}
        >
          {FIELD_TYPES.map(opt => (
            <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={
            <Checkbox
              checked={field.required}
              onChange={e => onUpdate(path, { required: e.target.checked })}
              size="small"
            />
          }
          label={<Typography variant="body2">Required</Typography>}
          sx={{ ml: 0, mt: 0.5 }}
        />
        {container && (
          <IconButton
            size="small"
            onClick={() => { setExpanded(true); onAddChild(path); }}
            title="Add child field"
            sx={{ mt: 0.5 }}
          >
            <Icon icon="mdi:plus" width="1rem" />
          </IconButton>
        )}
        <IconButton size="small" onClick={() => onRemove(path)} sx={{ mt: 0.5 }}>
          <Icon icon="mdi:close-circle-outline" width="1rem" />
        </IconButton>
      </Box>
      <Box display="flex" gap={0.5}>
        <TextField
          label="Description"
          value={field.description}
          onChange={e => onUpdate(path, { description: e.target.value })}
          size="small"
          sx={{ flex: 2 }}
        />
        {!container && (
          <TextField
            label="Default"
            value={field.defaultValue}
            onChange={e => onUpdate(path, { defaultValue: e.target.value })}
            size="small"
            placeholder={
              field.type === 'boolean' ? 'true / false'
                : field.type === 'string-array' ? 'a, b, c'
                : ''
            }
            sx={{ flex: 1 }}
          />
        )}
      </Box>
      {container && expanded && (
        <Box ml={3} mt={0.5}>
          {field.children.length === 0 ? (
            <Typography variant="caption" color="text.secondary">
              {field.type === 'object-array' ? 'Item shape' : 'Object shape'}: no children yet
              — preserves unknown fields. Click + above to add a child.
            </Typography>
          ) : (
            field.children.map((c, i) => (
              <FieldRow
                key={i}
                field={c}
                path={[...path, i]}
                errors={errors}
                onUpdate={onUpdate}
                onRemove={onRemove}
                onAddChild={onAddChild}
              />
            ))
          )}
        </Box>
      )}
    </Box>
  );
}

interface FieldTreeEditorProps {
  title: string;
  subtitle?: string;
  fields: FieldEntry[];
  errors: Set<string>;
  onAdd: () => void;
  onUpdate: (path: Path, patch: Partial<FieldEntry>) => void;
  onRemove: (path: Path) => void;
  onAddChild: (path: Path) => void;
}

function FieldTreeEditor({
  title,
  subtitle,
  fields,
  errors,
  onAdd,
  onUpdate,
  onRemove,
  onAddChild,
}: FieldTreeEditorProps) {
  return (
    <Box>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={0.5}>
        <Box>
          <Typography variant="subtitle2">{title}</Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Box>
        <IconButton size="small" onClick={onAdd} title={`Add ${title} field`}>
          <Icon icon="mdi:plus" width="0.875rem" />
        </IconButton>
      </Box>
      {fields.length === 0 && (
        <Typography variant="caption" color="text.secondary">
          No fields defined yet. Click + to add one.
        </Typography>
      )}
      {fields.map((f, i) => (
        <FieldRow
          key={i}
          field={f}
          path={[i]}
          errors={errors}
          onUpdate={onUpdate}
          onRemove={onRemove}
          onAddChild={onAddChild}
        />
      ))}
    </Box>
  );
}

// ── Top-level form ────────────────────────────────────────────────────────────

function XRDFormFields({
  existing,
  form,
}: {
  existing: any;
  form: ReturnType<typeof useXRDForm>;
}) {
  const {
    apiVersion, setApiVersion,
    scope, setScope,
    group, setGroup, groupError,
    kind, setKind, kindError,
    plural, setPlural, pluralError,
    singular, setSingular,
    versionName, setVersionName, versionError,
    served, setServed,
    referenceable, setReferenceable,
    specFields, addSpecChild, updateSpecField, removeSpecField, specKeyErrors,
    statusFields, addStatusChild, updateStatusField, removeStatusField, statusKeyErrors,
    defaultComposition, setDefaultComposition, compositionNames,
    claimKind, setClaimKind, claimPlural, setClaimPlural,
    derivedName,
  } = form;

  const isV1 = apiVersion === 'apiextensions.crossplane.io/v1';

  return (
    <>
      <Box display="flex" gap={1}>
        <TextField
          label="API Version"
          value={apiVersion}
          onChange={e => setApiVersion(e.target.value as ApiVersion)}
          select
          size="small"
          sx={{ flex: 1 }}
          disabled={!!existing}
        >
          <MenuItem value="apiextensions.crossplane.io/v2">v2 (recommended)</MenuItem>
          <MenuItem value="apiextensions.crossplane.io/v1">v1 (deprecated)</MenuItem>
        </TextField>
        <TextField
          label="Scope"
          value={scope}
          onChange={e => setScope(e.target.value as Scope)}
          select
          size="small"
          sx={{ flex: 1 }}
          disabled={isV1}
        >
          <MenuItem value="Namespaced">Namespaced</MenuItem>
          <MenuItem value="Cluster">Cluster</MenuItem>
          {isV1 && <MenuItem value="LegacyCluster">LegacyCluster (v1 only)</MenuItem>}
        </TextField>
      </Box>

      <Box>
        <Typography variant="subtitle2" gutterBottom>Names</Typography>
        <Box display="flex" flexDirection="column" gap={1}>
          <Box display="flex" gap={1}>
            <TextField
              label="Group"
              value={group}
              onChange={e => setGroup(e.target.value)}
              size="small"
              required
              error={groupError}
              helperText={groupError ? 'Must be a DNS-like name' : 'e.g. example.crossplane.io'}
              sx={{ flex: 2 }}
              disabled={!!existing}
            />
            <TextField
              label="Kind"
              value={kind}
              onChange={e => setKind(e.target.value)}
              size="small"
              required
              error={kindError}
              helperText={kindError ? 'Must be UpperCamelCase' : 'e.g. AppStack'}
              sx={{ flex: 1 }}
              disabled={!!existing}
            />
          </Box>
          <Box display="flex" gap={1}>
            <TextField
              label="Plural"
              value={plural}
              onChange={e => setPlural(e.target.value)}
              size="small"
              required
              error={pluralError}
              helperText={pluralError ? 'lowercase a–z and digits only' : 'e.g. appstacks'}
              sx={{ flex: 1 }}
              disabled={!!existing}
            />
            <TextField
              label="Singular"
              value={singular}
              onChange={e => setSingular(e.target.value)}
              size="small"
              helperText="optional, defaults to lowercased kind"
              sx={{ flex: 1 }}
              disabled={!!existing}
            />
          </Box>
          {derivedName && (
            <Typography variant="caption" color="text.secondary">
              metadata.name → <strong>{derivedName}</strong>
            </Typography>
          )}
        </Box>
      </Box>

      <Box>
        <Typography variant="subtitle2" gutterBottom>Version</Typography>
        <Box display="flex" gap={1} alignItems="center">
          <TextField
            label="Name"
            value={versionName}
            onChange={e => setVersionName(e.target.value)}
            size="small"
            required
            error={versionError}
            helperText={versionError ? 'e.g. v1, v1alpha1, v2beta1' : ''}
            sx={{ flex: 1 }}
          />
          <FormControlLabel
            control={
              <Checkbox checked={served} onChange={e => setServed(e.target.checked)} size="small" />
            }
            label={<Typography variant="body2">Served</Typography>}
          />
          <FormControlLabel
            control={
              <Checkbox
                checked={referenceable}
                onChange={e => setReferenceable(e.target.checked)}
                size="small"
              />
            }
            label={<Typography variant="body2">Referenceable</Typography>}
          />
        </Box>
      </Box>

      <FieldTreeEditor
        title="spec fields"
        subtitle="User-supplied inputs. Objects/arrays can have nested child fields."
        fields={specFields}
        errors={specKeyErrors}
        onAdd={() => addSpecChild([])}
        onUpdate={updateSpecField}
        onRemove={removeSpecField}
        onAddChild={addSpecChild}
      />

      <FieldTreeEditor
        title="status fields"
        subtitle="Outputs written by the composition. Required/default rarely apply here."
        fields={statusFields}
        errors={statusKeyErrors}
        onAdd={() => addStatusChild([])}
        onUpdate={updateStatusField}
        onRemove={removeStatusField}
        onAddChild={addStatusChild}
      />

      <Autocomplete
        freeSolo
        options={compositionNames}
        value={defaultComposition}
        onChange={(_, val) => setDefaultComposition(val ?? '')}
        onInputChange={(_, val) => setDefaultComposition(val)}
        renderInput={params => (
          <TextField
            {...params}
            label="Default composition"
            size="small"
            helperText={
              compositionNames.length === 0
                ? 'optional — no compositions match this kind yet'
                : `${compositionNames.length} matching composition${compositionNames.length === 1 ? '' : 's'} — optional`
            }
          />
        )}
      />

      {scope === 'LegacyCluster' && (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Claim names (optional — LegacyCluster only)
          </Typography>
          <Box display="flex" gap={1}>
            <TextField
              label="Claim Kind"
              value={claimKind}
              onChange={e => setClaimKind(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              placeholder={kind ? `${kind}Claim` : 'e.g. AppStackClaim'}
            />
            <TextField
              label="Claim Plural"
              value={claimPlural}
              onChange={e => setClaimPlural(e.target.value)}
              size="small"
              sx={{ flex: 1 }}
              placeholder={plural ? `${plural}claims` : ''}
            />
          </Box>
        </Box>
      )}

      <Box display="flex" alignItems="center" gap={1} color="text.secondary">
        <Icon icon="mdi:information-outline" width="1rem" />
        <Typography variant="caption">
          Use <Chip label="YAML ↗" size="small" component="span" /> for advanced features
          (additionalPrinterColumns, conversion, subresources, enums, validation patterns).
        </Typography>
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

export function XRDCreatePanel({ existing, onDone, activityId, cluster }: PanelProps) {
  const form = useXRDForm(existing, true);
  return (
    <ResourceHelperPanel
      resourceName="CompositeResourceDefinition"
      existing={existing}
      buildItem={form.buildItem}
      canSubmit={form.canSubmit}
      onReset={form.resetForm}
      onDone={onDone}
      activityId={activityId}
      cluster={cluster}
    >
      <XRDFormFields existing={existing} form={form} />
    </ResourceHelperPanel>
  );
}
