import { Icon } from '@iconify/react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ResourceHelperDialog,
  ResourceHelperPanel,
} from '../../components/ResourceHelperDialog';
import { RuntimeConfigRefField } from '../../components/RuntimeConfigRefField';

interface Identity {
  issuer: string;
  subject: string;
  issuerRegExp: string;
  subjectRegExp: string;
}

interface Attestation {
  name: string;
  predicateType: string;
}

interface Authority {
  name: string;
  identities: Identity[];
  attestations: Attestation[];
}

const emptyIdentity = (): Identity => ({
  issuer: '',
  subject: '',
  issuerRegExp: '',
  subjectRegExp: '',
});

const emptyAttestation = (): Attestation => ({ name: '', predicateType: '' });

const emptyAuthority = (): Authority => ({
  name: '',
  identities: [emptyIdentity()],
  attestations: [],
});

const NAME_REGEX = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

function seedAuthorities(spec: any): Authority[] {
  const authorities: any[] = spec?.verification?.cosign?.authorities ?? [];
  if (authorities.length === 0) return [];
  return authorities.map((a: any) => ({
    name: a.name ?? '',
    identities: (a.keyless?.identities ?? []).map((id: any) => ({
      issuer: id.issuer ?? '',
      subject: id.subject ?? '',
      issuerRegExp: id.issuerRegExp ?? '',
      subjectRegExp: id.subjectRegExp ?? '',
    })),
    attestations: (a.attestations ?? []).map((att: any) => ({
      name: att.name ?? '',
      predicateType: att.predicateType ?? '',
    })),
  }));
}

function buildVerification(authorities: Authority[]): Record<string, unknown> | undefined {
  const built = authorities
    .filter(a => a.name.trim())
    .map(a => {
      const auth: Record<string, unknown> = { name: a.name.trim() };
      const ids = a.identities.filter(
        id => id.issuer.trim() || id.subject.trim() || id.issuerRegExp.trim() || id.subjectRegExp.trim()
      );
      if (ids.length > 0) {
        auth.keyless = {
          identities: ids.map(id => {
            const obj: Record<string, string> = {};
            if (id.issuer.trim()) obj.issuer = id.issuer.trim();
            if (id.subject.trim()) obj.subject = id.subject.trim();
            if (id.issuerRegExp.trim()) obj.issuerRegExp = id.issuerRegExp.trim();
            if (id.subjectRegExp.trim()) obj.subjectRegExp = id.subjectRegExp.trim();
            return obj;
          }),
        };
      }
      const atts = a.attestations.filter(att => att.name.trim() || att.predicateType.trim());
      if (atts.length > 0) {
        auth.attestations = atts.map(att => {
          const obj: Record<string, string> = {};
          if (att.name.trim()) obj.name = att.name.trim();
          if (att.predicateType.trim()) obj.predicateType = att.predicateType.trim();
          return obj;
        });
      }
      return auth;
    });
  if (built.length === 0) return undefined;
  return { provider: 'Cosign', cosign: { authorities: built } };
}

function useImageConfigForm(existing: any | undefined, isOpen: boolean) {
  const [name, setName] = useState('');
  const [prefixes, setPrefixes] = useState<string[]>([]);
  const [prefixInput, setPrefixInput] = useState('');
  const [pullSecret, setPullSecret] = useState('');
  const [rewritePrefix, setRewritePrefix] = useState('');
  const [runtimeConfigRef, setRuntimeConfigRef] = useState('');
  const [authorities, setAuthorities] = useState<Authority[]>([]);

  const seededRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      seededRef.current = false;
      return;
    }
    if (seededRef.current || !existing) return;
    seededRef.current = true;
    setName(existing.metadata?.name ?? '');
    const matches: any[] = existing.jsonData?.spec?.matchImages ?? [];
    setPrefixes(matches.map((m: any) => m.prefix ?? '').filter(Boolean));
    setPullSecret(existing.jsonData?.spec?.registry?.authentication?.pullSecretRef?.name ?? '');
    setRewritePrefix(existing.jsonData?.spec?.rewriteImage?.prefix ?? '');
    setRuntimeConfigRef(existing.jsonData?.spec?.runtime?.configRef?.name ?? '');
    setAuthorities(seedAuthorities(existing.jsonData?.spec));
  }, [isOpen, existing]);

  const addPrefix = useCallback(() => {
    const trimmed = prefixInput.trim();
    if (trimmed && !prefixes.includes(trimmed)) setPrefixes(prev => [...prev, trimmed]);
    setPrefixInput('');
  }, [prefixInput, prefixes]);

  const removePrefix = useCallback((prefix: string) => {
    setPrefixes(prev => prev.filter(p => p !== prefix));
  }, []);

  const updateAuthority = useCallback((idx: number, patch: Partial<Authority>) => {
    setAuthorities(prev => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }, []);

  const updateIdentity = useCallback((authIdx: number, idIdx: number, patch: Partial<Identity>) => {
    setAuthorities(prev =>
      prev.map((a, ai) =>
        ai === authIdx
          ? { ...a, identities: a.identities.map((id, ii) => (ii === idIdx ? { ...id, ...patch } : id)) }
          : a
      )
    );
  }, []);

  const updateAttestation = useCallback((authIdx: number, attIdx: number, patch: Partial<Attestation>) => {
    setAuthorities(prev =>
      prev.map((a, ai) =>
        ai === authIdx
          ? { ...a, attestations: a.attestations.map((att, ati) => (ati === attIdx ? { ...att, ...patch } : att)) }
          : a
      )
    );
  }, []);

  const resetForm = useCallback(() => {
    setName('');
    setPrefixes([]);
    setPrefixInput('');
    setPullSecret('');
    setRewritePrefix('');
    setRuntimeConfigRef('');
    setAuthorities([]);
  }, []);

  const buildItem = useCallback(() => {
    const spec: Record<string, unknown> = {};
    const allPrefixes = [...prefixes];
    const pending = prefixInput.trim();
    if (pending && !allPrefixes.includes(pending)) allPrefixes.push(pending);
    if (allPrefixes.length > 0) spec.matchImages = allPrefixes.map(p => ({ type: 'Prefix', prefix: p }));
    const secret = pullSecret.trim();
    if (secret) spec.registry = { authentication: { pullSecretRef: { name: secret } } };
    const rw = rewritePrefix.trim();
    if (rw) spec.rewriteImage = { prefix: rw };
    const rt = runtimeConfigRef.trim();
    if (rt) spec.runtime = { configRef: { name: rt } };
    const verification = buildVerification(authorities);
    if (verification) spec.verification = verification;

    if (existing) {
      return { ...structuredClone(existing.jsonData), spec: { ...existing.jsonData.spec, ...spec } };
    }
    return { apiVersion: 'pkg.crossplane.io/v1beta1', kind: 'ImageConfig', metadata: { name: name.trim() || '<name>' }, spec };
  }, [existing, name, prefixes, prefixInput, pullSecret, rewritePrefix, runtimeConfigRef, authorities]);

  const hasPrefixes = prefixes.length > 0 || !!prefixInput.trim();
  const nameError = name.length > 0 && !NAME_REGEX.test(name);
  const canSubmit = name.length > 0 && !nameError && hasPrefixes;

  return {
    name, setName, nameError, canSubmit, buildItem, resetForm,
    prefixes, prefixInput, setPrefixInput, addPrefix, removePrefix,
    pullSecret, setPullSecret, rewritePrefix, setRewritePrefix,
    runtimeConfigRef, setRuntimeConfigRef,
    authorities, setAuthorities, updateAuthority, updateIdentity, updateAttestation,
  };
}

function ImageConfigFormFields({
  existing,
  form,
}: {
  existing: any;
  form: ReturnType<typeof useImageConfigForm>;
}) {
  const {
    name, setName, nameError,
    prefixes, prefixInput, setPrefixInput, addPrefix, removePrefix,
    pullSecret, setPullSecret, rewritePrefix, setRewritePrefix,
    runtimeConfigRef, setRuntimeConfigRef,
    authorities, setAuthorities, updateAuthority, updateIdentity, updateAttestation,
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
            ? 'Must be a valid Kubernetes name (lowercase alphanumeric, dashes, and dots)'
            : ''
        }
        fullWidth
        size="small"
        required
        disabled={!!existing}
      />

      {/* ── Match Prefixes ── */}
      <Box>
        <Typography variant="subtitle2" gutterBottom>
          Image Prefixes
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
          Registry prefixes to match (e.g. registry1.com/acme-co/). Longest prefix wins when
          multiple ImageConfigs overlap.
        </Typography>
        <Box display="flex" gap={1} alignItems="flex-start">
          <TextField
            label="Add prefix"
            value={prefixInput}
            onChange={e => setPrefixInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addPrefix();
              }
            }}
            fullWidth
            size="small"
            placeholder="registry.example.com/org/"
          />
          <IconButton onClick={addPrefix} disabled={!prefixInput.trim()} size="small">
            <Icon icon="mdi:plus-circle" />
          </IconButton>
        </Box>
        {prefixes.length > 0 && (
          <Box display="flex" flexWrap="wrap" gap={0.5} mt={1}>
            {prefixes.map(p => (
              <Chip key={p} label={p} size="small" onDelete={() => removePrefix(p)} />
            ))}
          </Box>
        )}
      </Box>

      {/* ── Pull Secret ── */}
      <TextField
        label="Pull Secret Name"
        value={pullSecret}
        onChange={e => setPullSecret(e.target.value)}
        fullWidth
        size="small"
        placeholder="my-registry-secret"
        helperText="Name of a kubernetes.io/dockerconfigjson Secret in the Crossplane namespace (optional)"
      />

      {/* ── Rewrite ── */}
      <TextField
        label="Rewrite Prefix"
        value={rewritePrefix}
        onChange={e => setRewritePrefix(e.target.value)}
        fullWidth
        size="small"
        placeholder="mirror.internal.com/crossplane/"
        helperText="Replace matched image prefixes for registry mirroring (optional)"
      />

      {/* ── Runtime Config ── */}
      <RuntimeConfigRefField value={runtimeConfigRef} onChange={setRuntimeConfigRef} />

      {/* ── Signature Verification ── */}
      <Box>
        <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
          <Typography variant="subtitle2">
            Signature Verification (Cosign)
          </Typography>
          <Button
            size="small"
            startIcon={<Icon icon="mdi:plus" />}
            onClick={() => setAuthorities(prev => [...prev, emptyAuthority()])}
          >
            Add Authority
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" display="block" mb={1}>
          Cosign keyless signature verification. Requires --enable-signature-verification on
          Crossplane. Verification succeeds if any authority matches.
        </Typography>

        {authorities.map((auth, authIdx) => (
          <Accordion
            key={authIdx}
            disableGutters
            elevation={0}
            variant="outlined"
            defaultExpanded
            sx={{ mb: 1 }}
          >
            <AccordionSummary
              expandIcon={<Typography sx={{ fontSize: '1rem', lineHeight: 1 }}>▾</Typography>}
            >
              <Box display="flex" alignItems="center" gap={1} flex={1}>
                <Typography variant="body2" fontWeight="medium">
                  {auth.name || `Authority ${authIdx + 1}`}
                </Typography>
              </Box>
              <IconButton
                size="small"
                onClick={e => {
                  e.stopPropagation();
                  setAuthorities(prev => prev.filter((_, i) => i !== authIdx));
                }}
              >
                <Icon icon="mdi:delete-outline" />
              </IconButton>
            </AccordionSummary>
            <AccordionDetails>
              <Box display="flex" flexDirection="column" gap={2}>
                <TextField
                  label="Authority Name"
                  value={auth.name}
                  onChange={e => updateAuthority(authIdx, { name: e.target.value })}
                  fullWidth
                  size="small"
                />

                {/* Identities */}
                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="body2" fontWeight="medium">
                      Keyless Identities
                    </Typography>
                    <Button
                      size="small"
                      onClick={() =>
                        updateAuthority(authIdx, {
                          identities: [...auth.identities, emptyIdentity()],
                        })
                      }
                    >
                      Add Identity
                    </Button>
                  </Box>
                  {auth.identities.map((id, idIdx) => (
                    <Box key={idIdx} mb={1}>
                      {idIdx > 0 && <Divider sx={{ mb: 1 }} />}
                      <Box display="flex" gap={1} alignItems="flex-start">
                        <Box display="flex" flexDirection="column" gap={1} flex={1}>
                          <Box display="flex" gap={1}>
                            <TextField
                              label="Issuer"
                              value={id.issuer}
                              onChange={e =>
                                updateIdentity(authIdx, idIdx, { issuer: e.target.value })
                              }
                              fullWidth
                              size="small"
                              placeholder="https://token.actions.githubusercontent.com"
                            />
                            <TextField
                              label="Issuer RegExp"
                              value={id.issuerRegExp}
                              onChange={e =>
                                updateIdentity(authIdx, idIdx, { issuerRegExp: e.target.value })
                              }
                              fullWidth
                              size="small"
                            />
                          </Box>
                          <Box display="flex" gap={1}>
                            <TextField
                              label="Subject"
                              value={id.subject}
                              onChange={e =>
                                updateIdentity(authIdx, idIdx, { subject: e.target.value })
                              }
                              fullWidth
                              size="small"
                              placeholder="https://github.com/org/repo/.github/workflows/ci.yml@refs/heads/main"
                            />
                            <TextField
                              label="Subject RegExp"
                              value={id.subjectRegExp}
                              onChange={e =>
                                updateIdentity(authIdx, idIdx, { subjectRegExp: e.target.value })
                              }
                              fullWidth
                              size="small"
                            />
                          </Box>
                        </Box>
                        {auth.identities.length > 1 && (
                          <IconButton
                            size="small"
                            onClick={() =>
                              updateAuthority(authIdx, {
                                identities: auth.identities.filter((_, i) => i !== idIdx),
                              })
                            }
                          >
                            <Icon icon="mdi:close" />
                          </IconButton>
                        )}
                      </Box>
                    </Box>
                  ))}
                </Box>

                {/* Attestations */}
                <Box>
                  <Box display="flex" justifyContent="space-between" alignItems="center" mb={1}>
                    <Typography variant="body2" fontWeight="medium">
                      Attestations
                    </Typography>
                    <Button
                      size="small"
                      onClick={() =>
                        updateAuthority(authIdx, {
                          attestations: [...auth.attestations, emptyAttestation()],
                        })
                      }
                    >
                      Add Attestation
                    </Button>
                  </Box>
                  {auth.attestations.map((att, attIdx) => (
                    <Box key={attIdx} display="flex" gap={1} alignItems="flex-start" mb={1}>
                      <TextField
                        label="Name"
                        value={att.name}
                        onChange={e =>
                          updateAttestation(authIdx, attIdx, { name: e.target.value })
                        }
                        fullWidth
                        size="small"
                      />
                      <TextField
                        label="Predicate Type"
                        value={att.predicateType}
                        onChange={e =>
                          updateAttestation(authIdx, attIdx, { predicateType: e.target.value })
                        }
                        fullWidth
                        size="small"
                        placeholder="spdxjson"
                      />
                      <IconButton
                        size="small"
                        onClick={() =>
                          updateAuthority(authIdx, {
                            attestations: auth.attestations.filter((_, i) => i !== attIdx),
                          })
                        }
                      >
                        <Icon icon="mdi:close" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              </Box>
            </AccordionDetails>
          </Accordion>
        ))}
      </Box>
    </>
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  existing?: any;
}

export function ImageConfigCreateDialog({ open, onClose, existing }: DialogProps) {
  const form = useImageConfigForm(existing, open);
  return (
    <ResourceHelperDialog
      open={open}
      onClose={onClose}
      resourceName="Image Config"
      existing={existing}
      buildItem={form.buildItem}
      canSubmit={form.canSubmit}
      onReset={form.resetForm}
    >
      <ImageConfigFormFields existing={existing} form={form} />
    </ResourceHelperDialog>
  );
}

interface PanelProps {
  existing?: any;
  onDone?: () => void;
  activityId?: string;
  cluster?: string;
}

export function ImageConfigCreatePanel({ existing, onDone, activityId, cluster }: PanelProps) {
  const form = useImageConfigForm(existing, true);
  return (
    <ResourceHelperPanel
      resourceName="Image Config"
      existing={existing}
      buildItem={form.buildItem}
      canSubmit={form.canSubmit}
      onReset={form.resetForm}
      onDone={onDone}
      activityId={activityId}
      cluster={cluster}
    >
      <ImageConfigFormFields existing={existing} form={form} />
    </ResourceHelperPanel>
  );
}

