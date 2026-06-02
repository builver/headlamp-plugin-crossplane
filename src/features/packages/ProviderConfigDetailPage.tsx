import { Activity, K8s } from '@kinvolk/headlamp-plugin/lib';
import {
  ConditionsTable,
  DataField,
  Link,
  MainInfoSection,
  SectionBox,
  Table,
} from '@kinvolk/headlamp-plugin/lib/components/common';
import { KubeObject } from '@kinvolk/headlamp-plugin/lib/k8s/cluster';
import { Box, Chip, Link as MuiLink, Typography } from '@mui/material';
import { useMemo } from 'react';
import { stringify as yamlStringify } from 'yaml';
import { linkSx } from '../../components/ActivityNameLink';
import { ReadyStatus } from '../../components/ConditionStatus';
import { ConfigCRDInfo, getOrCreateClass, STUB_CLASS } from '../../resources/crdClassCache';
import { MRDetailInner } from '../managed/MRDetailPage';

interface MRDLookup {
  mrdName: string;
  isNamespaced: boolean;
}

function getResourceRef(item: any) {
  return item.jsonData?.spec?.resourceRef ?? item.jsonData?.resourceRef;
}

function getProviderConfigRef(item: any) {
  return item.jsonData?.spec?.providerConfigRef ?? item.jsonData?.providerConfigRef;
}

function parseCRDInfo(crd: KubeObject): ConfigCRDInfo {
  const spec = crd.jsonData?.spec;
  return {
    crdName: crd.metadata.name,
    group: spec.group,
    kind: spec.names.kind,
    plural: spec.names.plural,
    versions: (spec.versions ?? [])
      .filter((v: any) => v.served !== false)
      .map((v: any) => ({ group: spec.group, version: v.name })),
    isNamespaced: spec.scope === 'Namespaced',
  };
}

export function ProviderConfigDetailInner({
  crdName,
  name,
}: {
  crdName: string;
  name: string;
}) {
  // ── Hook 1–2: Resolve CRD info ──────────────────────────────────────────
  const [crds] = K8s.ResourceClasses.CustomResourceDefinition.useList();

  // Single pass: resolve config CRD, usage CRD, and kind→group lookup map
  const { crdInfo, usageCRD, crdByKindGroup } = useMemo(() => {
    const result: {
      crdInfo: ConfigCRDInfo | null;
      usageCRD: ConfigCRDInfo | null;
      crdByKindGroup: Map<string, MRDLookup>;
    } = { crdInfo: null, usageCRD: null, crdByKindGroup: new Map() };
    if (!crds) return result;

    let configGroup: string | null = null;
    for (const crd of crds) {
      if (crd.metadata.name === crdName) {
        result.crdInfo = parseCRDInfo(crd);
        configGroup = result.crdInfo.group;
      }
      const spec = crd.jsonData?.spec;
      const kind = spec?.names?.kind;
      const group = spec?.group;
      if (kind && group && spec?.names?.plural) {
        result.crdByKindGroup.set(`${kind}/${group}`, {
          mrdName: crd.metadata.name,
          isNamespaced: spec.scope === 'Namespaced',
        });
      }
    }
    // Second quick scan for usage CRD (only if config is cluster-scoped)
    if (result.crdInfo && !result.crdInfo.isNamespaced && configGroup) {
      for (const crd of crds) {
        const spec = crd.jsonData?.spec;
        if (spec?.group === configGroup && spec.names.kind === 'ProviderConfigUsage') {
          result.usageCRD = parseCRDInfo(crd);
          break;
        }
      }
    }
    return result;
  }, [crds, crdName]);

  const showUsages = crdInfo ? !crdInfo.isNamespaced : false;

  // ── Hook 3: Fetch the ProviderConfig instance ──────────────────────────
  const ConfigClass = crdInfo ? getOrCreateClass(crdInfo) : STUB_CLASS;
  const [item] = ConfigClass.useGet(name);

  // ── Hook 4: Fetch all usages ───────────────────────────────────────────
  const UsageClass = usageCRD ? getOrCreateClass(usageCRD) : STUB_CLASS;
  const [allUsages] = UsageClass.useList();

  // ── Hook 5: Filter + sort usages ───────────────────────────────────────
  const filtered = useMemo(() => {
    if (!showUsages || !allUsages) return null;
    return allUsages
      .filter((u: KubeObject) => getProviderConfigRef(u)?.name === name)
      .sort((a: KubeObject, b: KubeObject) => {
        const aKind = getResourceRef(a)?.kind ?? '';
        const bKind = getResourceRef(b)?.kind ?? '';
        return aKind.localeCompare(bKind);
      });
  }, [showUsages, allUsages, name]);

  // ── Hook 6: Spec YAML ──────────────────────────────────────────────────
  const realItem = crdInfo ? item : null;
  const specYaml = useMemo(() => {
    if (!realItem?.jsonData?.spec) return null;
    return yamlStringify(realItem.jsonData.spec, { blockQuote: true });
  }, [realItem]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (!crdInfo) return <Typography>Loading…</Typography>;

  const extraInfo = realItem
    ? [
        { name: 'Kind', value: crdInfo.kind },
        { name: 'API Group', value: crdInfo.group },
        { name: 'Ready', value: <ReadyStatus item={realItem} /> },
      ]
    : [];

  return (
    <Box pb={9}>
      <MainInfoSection resource={realItem} extraInfo={extraInfo} noDefaultActions backLink={null} />
      {realItem && <ConditionsTable resource={realItem.jsonData} />}
      {specYaml && (
        <SectionBox title={<Typography variant="subtitle1">Spec</Typography>}>
          <DataField label="spec.yaml" disableLabel value={specYaml} onChange={() => {}} />
        </SectionBox>
      )}
      {showUsages && <UsagesTable filtered={filtered} crdByKindGroup={crdByKindGroup} usagesNamespaced={usageCRD?.isNamespaced ?? false} />}
    </Box>
  );
}

/** Pure render component — no hooks, so it can be conditionally rendered safely. */
function UsagesTable({
  filtered,
  crdByKindGroup,
  usagesNamespaced,
}: {
  filtered: KubeObject[] | null;
  crdByKindGroup: Map<string, MRDLookup>;
  usagesNamespaced: boolean;
}) {
  if (filtered === null) {
    return (
      <SectionBox title={<Typography variant="h5">Provider Config Usages</Typography>}>
        <Typography>Loading usages…</Typography>
      </SectionBox>
    );
  }

  if (filtered.length === 0) {
    return (
      <SectionBox title={<Typography variant="h5">Provider Config Usages</Typography>}>
        <Typography variant="body2" color="text.secondary">
          No resources are currently using this config.
        </Typography>
      </SectionBox>
    );
  }

  return (
    <SectionBox
      title={
        <Box display="flex" alignItems="center" gap={1}>
          <Typography variant="h5">Provider Config Usages</Typography>
          <Chip label={filtered.length} size="small" />
        </Box>
      }
    >
      <Table
        data={filtered}
        initialState={{ sorting: [{ id: 'Kind', desc: false }] }}
        columns={[
          {
            header: 'API Version',
            accessorFn: (item: any) => getResourceRef(item)?.apiVersion ?? '-',
          },
          {
            header: 'Kind',
            id: 'Kind',
            accessorFn: (item: any) => getResourceRef(item)?.kind ?? '-',
            Cell: ({ row: { original: item } }: any) => {
              const ref = getResourceRef(item);
              const kind = ref?.kind;
              const group = (ref?.apiVersion as string)?.split('/')[0];
              const lookup = kind && group ? crdByKindGroup.get(`${kind}/${group}`) : undefined;
              if (!lookup) return kind ?? '-';
              return (
                <Link routeName="crossplane-mr-list" params={{ mrdName: lookup.mrdName }}>
                  {kind}
                </Link>
              );
            },
          },
          ...(usagesNamespaced ? [{
            header: 'Namespace',
            accessorFn: (item: any) => getResourceRef(item)?.namespace ?? item.metadata?.namespace ?? '-',
          }] : []),
          {
            header: 'Name',
            accessorFn: (item: any) => getResourceRef(item)?.name ?? '-',
            Cell: ({ row: { original: item } }: any) => {
              const ref = getResourceRef(item);
              const resName = ref?.name;
              const kind = ref?.kind;
              const group = (ref?.apiVersion as string)?.split('/')[0];
              const lookup = kind && group ? crdByKindGroup.get(`${kind}/${group}`) : undefined;
              if (!lookup || !resName) return resName ?? '-';
              const ns = ref?.namespace ?? (lookup.isNamespaced ? item.metadata?.namespace : undefined);
              const launch = () => {
                const id = `crossplane-mr-${lookup.mrdName}-${ns ?? ''}-${resName}`;
                Activity.launch({
                  id,
                  title: `${kind} ${resName}`,
                  hideTitleInHeader: true,
                  location: 'split-right',
                  cluster: item.cluster,
                  content: (
                    <MRDetailInner
                      mrdName={lookup.mrdName}
                      name={resName}
                      namespace={ns}
                    />
                  ),
                });
              };
              return (
                <MuiLink component="button" onClick={launch} sx={linkSx}>
                  {resName}
                </MuiLink>
              );
            },
          },
        ]}
      />
    </SectionBox>
  );
}
